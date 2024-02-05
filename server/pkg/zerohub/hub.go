package zerohub

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/lithammer/shortuuid/v4"
	pb "github.com/ntsd/zero-hub/server/pkg/proto"
	"github.com/rs/zerolog/log"
)

type Hub interface {
	GetID() string
	GetCreatedAt() time.Time
	GetPeers() map[uint32]Peer
	SetZeroHub(zeroHub ZeroHub)
	RemovePeerByID(id uint32)

	SendOfferToPeer(toPeerId uint32, offerPeerID uint32, offerSDP string)
	SendAnswerToPeer(toPeerId uint32, answerPeerID uint32, answerSDP string)

	AddPeer(p Peer)
}

type hub struct {
	ID        string
	CreatedAt time.Time

	CurrentPeerID atomic.Uint32
	Peers         map[uint32]Peer

	ZeroHub ZeroHub

	mu sync.RWMutex
}

func NewHub() (Hub, error) {
	return &hub{
		ID:        shortuuid.New(),
		CreatedAt: time.Now(),
		Peers:     make(map[uint32]Peer),
	}, nil
}

// AddPeer creates a new peer and connects it to all existing peers in the mesh network.
func (h *hub) AddPeer(newPeer Peer) {
	newPeer.SetID(h.CurrentPeerID.Add(1))
	newPeer.SetHub(h)

	h.mu.Lock()

	h.Peers[newPeer.GetID()] = newPeer

	peersProtobuf := []*pb.Peer{}

	// broadcast peer joined for all peers
	joinedSignalProto, err := CreateJoinedSignalProtobuf(newPeer.ToProtobuf())
	if err != nil {
		log.Error().Msg(err.Error())
		return
	}
	for _, peer := range h.Peers {
		if peer.GetID() != newPeer.GetID() {
			peer.SendBinaryMessage(joinedSignalProto)
		}
		peersProtobuf = append(peersProtobuf, peer.ToProtobuf())
	}

	h.mu.Unlock()

	// send hub info to the new peer
	newPeer.SendHubInfo(peersProtobuf)
}

// RemovePeerByID removes a peer from the mesh network and disconnects it from all other peers.
func (h *hub) RemovePeerByID(id uint32) {
	dcSignalProto, err := CreateDisconnectSignalProtobuf(id)
	if err != nil {
		log.Error().Msg(err.Error())
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.Peers, id)

	// broadcast peer disconnected
	for _, peer := range h.Peers {
		if peer.GetID() != id {
			peer.SendBinaryMessage(dcSignalProto)
		}
	}

	// remove hub if it has no peers left
	if len(h.Peers) == 0 {
		h.ZeroHub.RemoveHubByID(h.ID)
	}
}

func (h *hub) GetID() string {
	return h.ID
}

func (h *hub) GetCreatedAt() time.Time {
	return h.CreatedAt
}

func (h *hub) GetPeers() map[uint32]Peer {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return h.Peers
}

func (h *hub) SetZeroHub(zeroHub ZeroHub) {
	h.ZeroHub = zeroHub
}

// (h *hub) SendOfferToPeer send offer sdp to other peer.
func (h *hub) SendOfferToPeer(toPeerId uint32, offerPeerID uint32, offerSDP string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if (h.Peers[toPeerId] == nil) || (h.Peers[toPeerId].GetWSConn() == nil) {
		log.Error().Msg("error to send request answer: peer not found")
		return
	}

	h.Peers[toPeerId].SendOffer(offerPeerID, offerSDP)
}

// (h *hub) SendAnswerToPeer send answer sdp to other peer.
func (h *hub) SendAnswerToPeer(toPeerId uint32, answerPeerID uint32, answerSDP string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if (h.Peers[toPeerId] == nil) || (h.Peers[toPeerId].GetWSConn() == nil) {
		log.Error().Msg("error to send request accept: peer not found")
		return
	}

	h.Peers[toPeerId].SendAnswer(answerPeerID, answerSDP)
}
