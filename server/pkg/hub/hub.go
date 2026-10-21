package hub

import (
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	websocket "github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"github.com/hotcode-dev/zerohub/pkg/storage"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Hub is an interface for a hub that manages a group of peers.
type Hub interface {
	// GetId returns the ID of the hub.
	GetId() string
	// GetMetadata returns the metadata of the hub.
	GetMetadata() string
	// GetCreatedAt returns the creation time of the hub.
	GetCreatedAt() time.Time
	// RemovePeerById removes a peer from the hub by its ID.
	// It returns true if the hub is empty after the peer is removed.
	RemovePeerById(id string) (emptyPeer bool)
	// RemovePeerIfLast atomically removes the peer and, only when that peer
	// was the hub's last member, also deletes the hub from HubStorage. The
	// roster mutation and the hub deletion happen under the hub's
	// peer-mutation lock, so a concurrent join cannot register a new peer
	// in between — without it the hub object could be removed from storage
	// while it still holds a just-joined peer, orphaning that peer and
	// making a live static/permanent room permanently unjoinable.
	// Permanent hubs are never deleted.
	RemovePeerIfLast(id string, hubStorage storage.Storage[Hub])
	// HandleMessage handles a message from a peer.
	HandleMessage(p peer.Peer)
	// SendOfferToPeer sends an offer to a peer.
	SendOfferToPeer(toPeerId string, offerPeerId string, offerSdp string)
	// SendAnswerToPeer sends an answer to a peer.
	SendAnswerToPeer(toPeerId string, answerPeerId string, answerSdp string)
	// SendIceCandidateToPeer sends a trickled ICE candidate to a peer.
	SendIceCandidateToPeer(toPeerId string, icePeerId string, candidate string)
	// AddPeer adds a peer to the hub.
	AddPeer(p peer.Peer)
}

// hub implements the Hub interface.
type hub struct {
	// Id is the unique identifier of the hub.
	Id string `json:"id"`
	// CreatedAt is the timestamp when the hub was created.
	CreatedAt time.Time `json:"createdAt"`
	// Metadata is the metadata associated with the hub.
	Metadata string `json:"metadata"`
	// IsPermanent is a flag that indicates whether the hub is permanent.
	IsPermanent bool `json:"isPermanent"`
	// CurrentPeerId is the atomic counter for the peer ID.
	CurrentPeerId atomic.Uint64 `json:"-"`
	// PeerStorage is the storage for the peers.
	PeerStorage storage.Storage[peer.Peer] `json:"-"`
	// mu serializes peer-roster mutations on this hub. AddPeer and
	// RemovePeerById/RemovePeerIfLast take the write lock around their
	// storage mutations, so the last peer's removal and a concurrent
	// join's registration can never interleave; the relay helpers take
	// the read lock so a broadcast can never overlap a roster mutation.
	// The lock is NOT held across the WebSocket writes in the
	// join/disconnect broadcasts: storage iteration snapshots the roster
	// and yields after releasing its own lock, so a stalled send cannot
	// pin mu and serialize the whole hub.
	mu sync.RWMutex `json:"-"`
	// closing is set (under mu) by RemovePeerIfLast at the moment the hub
	// begins deletion from HubStorage. AddPeer checks it under mu so that
	// a join racing the last peer's departure — which may have already
	// fetched this hub object before it left storage — is rejected instead
	// of registering a peer into a hub that is (about to be) gone. This
	// closes the delete-then-add window that the re-check alone leaves
	// open.
	closing atomic.Bool `json:"-"`
}

// NewHub creates a new hub.
func NewHub(hubId string, metadata string, peerStorage storage.Storage[peer.Peer], isPermanent bool) (Hub, error) {
	return &hub{
		Id:          hubId,
		CreatedAt:   time.Now(),
		PeerStorage: peerStorage,
		Metadata:    metadata,
		IsPermanent: isPermanent,
	}, nil
}

// AddPeer adds a peer to the hub.
// The join signal is marshaled BEFORE the peer is registered in PeerStorage
// (same validate-then-mutate ordering as RemovePeerById), so a marshal failure
// is a no-op: no peer ID side effect, no storage entry, no broadcast, and the
// new peer is never left half-registered without its HubInfo.
func (h *hub) AddPeer(newPeer peer.Peer) {
	h.mu.Lock()
	// The peer ID is assigned and the join signal is validated under the
	// peer-mutation lock; the registration + broadcast follow without it
	// (see the note on mu).
	//
	// closing is checked in the same lock section so a join that already
	// fetched this hub object before it was removed from HubStorage cannot
	// still register here: RemovePeerIfLast sets closing under the same
	// lock before the hub's storage entry disappears, and the check above
	// is the only interleaving that survives the Add-before-Delete
	// ordering (the delete-then-add window the emptiness re-check alone
	// does not cover).
	if h.closing.Load() {
		h.mu.Unlock()
		log.Warn().Str("hub_id", h.Id).Msg("rejecting join: hub is closing")
		return
	}
	newPeer.SetId(strconv.FormatUint(h.CurrentPeerId.Add(1), 10))

	// build the join signal before mutating any state
	joinedSignalProto, err := CreateJoinedSignalProtobuf(newPeer.ToProtobuf())
	h.mu.Unlock()
	if err != nil {
		log.Error().Msg(err.Error())
		return
	}

	h.mu.Lock()
	// Register the peer under the peer-mutation lock: a concurrent
	// RemovePeerIfLast cannot observe a half-empty hub and delete it from
	// HubStorage while this peer is being registered. The broadcast
	// snapshot (this peer plus every peer present after the Add) is taken
	// under the same lock.
	//
	// Re-check closing here, in the authoritative registration section,
	// not just in the first lock section: between that earlier check and
	// this lock section the hub can be deleted from storage by a racing
	// RemovePeerIfLast (the delete-then-add window). If it was, reject
	// instead of registering a peer into a hub that is no longer
	// reachable via GetHubById.
	if h.closing.Load() {
		h.mu.Unlock()
		log.Warn().Str("hub_id", h.Id).Msg("rejecting join: hub is closing")
		return
	}
	h.PeerStorage.Add(newPeer.GetId(), newPeer)
	peers := make([]peer.Peer, 0, 1)
	for p := range h.PeerStorage.GetAll() {
		peers = append(peers, p)
	}
	h.mu.Unlock()
	peersProtobuf := []*pb.Peer{}
	for _, p := range peers {
		if p.GetId() != newPeer.GetId() {
			if err := p.SendBinaryMessage(joinedSignalProto); err != nil {
				log.Error().Err(err).Str("peer_id", p.GetId()).Msg("error sending joined signal")
			}
			peersProtobuf = append(peersProtobuf, p.ToProtobuf())
		}
	}

	// send hub info to the new peer
	if err := newPeer.SendHubInfo(&pb.HubInfoMessage{
		Id:          h.GetId(),
		MyPeerId:    newPeer.GetId(),
		CreateTime:  timestamppb.New(h.GetCreatedAt()),
		Peers:       peersProtobuf,
		HubMetadata: h.GetMetadata(),
	}); err != nil {
		log.Error().Err(err)
	}
}

// RemovePeerById removes a peer from the mesh network and disconnects it from all other peers.
// It is idempotent: if the peer is not in the hub, nothing is broadcast and false is returned,
// so a duplicate removal (e.g. close handler plus post-HandleMessage fallback) cannot double-send
// the disconnect signal or double-trigger hub removal.
func (h *hub) RemovePeerById(id string) (removeThisHub bool) {
	return h.removePeer(id)
}

// RemovePeerIfLast atomically removes the peer and, when that peer was the
// hub's last member, deletes the hub from hubStorage. The removal, the
// emptiness check, and the hub deletion all happen under the hub's
// peer-mutation lock: a concurrent join's AddPeer cannot register a peer in
// between, so a live static/permanent room can never be deleted from storage
// while still holding a just-joined peer (which would orphan that peer and
// make the room permanently unjoinable). Permanent hubs are never deleted
// from storage.
func (h *hub) RemovePeerIfLast(id string, hubStorage storage.Storage[Hub]) {
	if !h.removePeer(id) {
		// Either the peer was not in the hub (no-op) or the hub still has
		// members / is permanent: nothing to delete.
		return
	}

	h.mu.Lock()
	// Re-check under the lock: a concurrent AddPeer cannot have registered
	// a peer since the check inside removePeer (its write-locked section
	// overlaps with this one), but the re-check makes the primitive
	// self-contained.
	if !h.PeerStorage.IsEmpty() {
		h.mu.Unlock()
		return
	}
	// Mark the hub closing in the same lock section as the delete: a join
	// that already fetched this hub object before it left storage is
	// rejected in AddPeer's registration section (see closing), so the
	// delete-then-add window cannot register a peer into a hub that is
	// going away.
	h.closing.Store(true)
	hubStorage.Delete(h.Id)
	h.mu.Unlock()
}

// removePeer performs the peer removal: storage lookup, delete, and the
// disconnect broadcast. It returns whether the hub is empty afterwards; the
// emptiness check is taken under the peer-mutation lock together with the
// delete, so a concurrent AddPeer's registration is never missed. The
// broadcast runs without holding mu — see the note on mu. If the peer was
// not in the hub the result is false (no removal, no broadcast).
func (h *hub) removePeer(id string) (empty bool) {
	h.mu.Lock()
	if _, err := h.PeerStorage.Get(id); err != nil {
		h.mu.Unlock()
		return false
	}

	// Delete the peer, take the emptiness decision, and snapshot the
	// remaining roster in one critical section: the emptiness check cannot
	// miss a concurrent AddPeer's registration (its write-locked section
	// overlaps with this one).
	h.PeerStorage.Delete(id)
	empty = !h.IsPermanent && h.PeerStorage.IsEmpty()
	peers := make([]peer.Peer, 0)
	for p := range h.PeerStorage.GetAll() {
		peers = append(peers, p)
	}
	h.mu.Unlock()

	dcSignalProto, err := CreateDisconnectSignalProtobuf(id)
	if err != nil {
		log.Error().Msg(err.Error())
	}

	// broadcast peer disconnected
	if err == nil {
		for _, p := range peers {
			if p.GetId() != id {
				if sendErr := p.SendBinaryMessage(dcSignalProto); sendErr != nil {
					log.Error().Err(sendErr).Str("peer_id", p.GetId()).Msg("error sending disconnected signal")
				}
			}
		}
	}

	return empty
}

func (h *hub) GetId() string {
	return h.Id
}

func (h *hub) GetMetadata() string {
	return h.Metadata
}

func (h *hub) GetCreatedAt() time.Time {
	return h.CreatedAt
}

// (h *hub) SendOfferToPeer send offer sdp to other peer.
func (h *hub) SendOfferToPeer(toPeerId string, offerPeerId string, offerSdp string) {
	h.mu.RLock()
	peer, err := h.PeerStorage.Get(toPeerId)
	h.mu.RUnlock()

	if peer != nil && peer.GetWSConn() != nil && err == nil {
		if err := peer.SendOffer(offerPeerId, offerSdp); err != nil {
			log.Error().Err(err).Str("peer_id", toPeerId).Msg("error sending offer")
		}
	} else {
		log.Error().Msg("error to send request answer: peer not found")
	}
}

// (h *hub) SendAnswerToPeer send answer sdp to other peer.
func (h *hub) SendAnswerToPeer(toPeerId string, answerPeerId string, answerSdp string) {
	h.mu.RLock()
	peer, err := h.PeerStorage.Get(toPeerId)
	h.mu.RUnlock()

	if peer != nil && peer.GetWSConn() != nil && err == nil {
		if err := peer.SendAnswer(answerPeerId, answerSdp); err != nil {
			log.Error().Err(err).Str("peer_id", toPeerId).Msg("error sending answer to peer")
		}
	} else {
		log.Error().Msg("error to send answer to peer: peer not found")
	}
}

// (h *hub) SendIceCandidateToPeer send trickled ice candidate to other peer.
func (h *hub) SendIceCandidateToPeer(toPeerId string, icePeerId string, candidate string) {
	h.mu.RLock()
	peer, err := h.PeerStorage.Get(toPeerId)
	h.mu.RUnlock()

	if peer != nil && peer.GetWSConn() != nil && err == nil {
		if err := peer.SendIceCandidate(icePeerId, candidate); err != nil {
			log.Error().Err(err).Str("peer_id", toPeerId).Msg("error sending ice candidate to peer")
		}
	} else {
		log.Error().Msg("error to send ice candidate to peer: peer not found")
	}
}

func (h *hub) HandleMessage(p peer.Peer) {
	var exitErr error
	for {
		wsMsgType, message, err := p.GetWSConn().ReadMessage()
		if err != nil {
			exitErr = fmt.Errorf("error to read message: %v", err)
			break
		}

		if wsMsgType != websocket.BinaryMessage {
			exitErr = errors.New("message type is not support")
			break
		}

		clientMessage := &pb.ClientMessage{}
		if err := proto.Unmarshal(message, clientMessage); err != nil {
			exitErr = fmt.Errorf("error to unmarshal client message: %v", err)
			break
		}

		switch {
		case clientMessage.GetSendOfferMessage() != nil:
			m := clientMessage.GetSendOfferMessage()
			if m.AnswerPeerId != p.GetId() {
				h.SendOfferToPeer(m.AnswerPeerId, p.GetId(), m.OfferSdp)
			} else {
				log.Warn().Msgf("ignoring self-targeted send-offer from peer %s", p.GetId())
			}
		case clientMessage.GetSendAnswerMessage() != nil:
			m := clientMessage.GetSendAnswerMessage()
			if m.OfferPeerId != p.GetId() {
				h.SendAnswerToPeer(m.OfferPeerId, p.GetId(), m.AnswerSdp)
			} else {
				log.Warn().Msgf("ignoring self-targeted send-answer from peer %s", p.GetId())
			}
		case clientMessage.GetSendIceCandidateMessage() != nil:
			m := clientMessage.GetSendIceCandidateMessage()
			if m.PeerId != p.GetId() {
				h.SendIceCandidateToPeer(m.PeerId, p.GetId(), m.Candidate)
			} else {
				log.Warn().Msgf("ignoring self-targeted send-ice-candidate from peer %s", p.GetId())
			}
		default:
			log.Error().Msg("invalid client message type")
		}
	}

	if exitErr != nil {
		log.Error().Err(exitErr)
	}
}
