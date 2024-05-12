package zerohub

import (
	"sync"
	"sync/atomic"
	"time"

	pb "github.com/hotcode-dev/zerohub/pkg/proto"
	"github.com/rs/zerolog/log"
)

// TODO: add Hub timeout to disconnect all the Websockets, then clear the hub memory. (12 Hours)
type Hub interface {
	GetId() string
	GetMetadata() string
	GetCreatedAt() time.Time
	GetPeers() map[uint32]Peer
	SetZeroHub(zeroHub ZeroHub)
	RemovePeerById(id uint32)

	SendOfferToPeer(toPeerId uint32, offerPeerId uint32, offerSdp string)
	SendAnswerToPeer(toPeerId uint32, answerPeerId uint32, answerSdp string)

	AddPeer(p Peer)
}

type hub struct {
	Id          string    `json:"id"`
	CreatedAt   time.Time `json:"createdAt"`
	Metadata    string    `json:"metadata"`
	IsPermanent bool      `json:"isPermanent"`

	CurrentPeerId atomic.Uint32   `json:"-"`
	Peers         map[uint32]Peer `json:"peers"`

	ZeroHub ZeroHub `json:"-"`

	mu sync.RWMutex `json:"-"`
}

func NewHub(hubId string, metadata string, isPermanent bool) (Hub, error) {
	return &hub{
		Id:          hubId,
		CreatedAt:   time.Now(),
		Peers:       make(map[uint32]Peer),
		Metadata:    metadata,
		IsPermanent: isPermanent,
	}, nil
}

// AddPeer creates a new peer and connects it to all existing peers in the mesh network.
func (h *hub) AddPeer(newPeer Peer) {
	newPeer.SetId(h.CurrentPeerId.Add(1))
	newPeer.SetHub(h)

	h.mu.Lock()

	h.Peers[newPeer.GetId()] = newPeer

	peersProtobuf := []*pb.Peer{}

	// broadcast peer joined for all peers
	joinedSignalProto, err := CreateJoinedSignalProtobuf(newPeer.ToProtobuf())
	if err != nil {
		log.Error().Msg(err.Error())
		return
	}
	for _, peer := range h.Peers {
		if peer.GetId() != newPeer.GetId() {
			peer.SendBinaryMessage(joinedSignalProto)
		}
		peersProtobuf = append(peersProtobuf, peer.ToProtobuf())
	}

	h.mu.Unlock()

	// send hub info to the new peer
	newPeer.SendHubInfo(peersProtobuf)
}

// RemovePeerById removes a peer from the mesh network and disconnects it from all other peers.
func (h *hub) RemovePeerById(id uint32) {
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
		if peer.GetId() != id {
			peer.SendBinaryMessage(dcSignalProto)
		}
	}

	if h.IsPermanent {
		return
	}

	// remove hub if it has no peers left
	if len(h.Peers) == 0 {
		h.ZeroHub.RemoveHubById(h.Id)
	}
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

func (h *hub) GetPeers() map[uint32]Peer {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return h.Peers
}

func (h *hub) SetZeroHub(zeroHub ZeroHub) {
	h.ZeroHub = zeroHub
}

// (h *hub) SendOfferToPeer send offer sdp to other peer.
func (h *hub) SendOfferToPeer(toPeerId uint32, offerPeerId uint32, offerSdp string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.Peers[toPeerId] == nil || h.Peers[toPeerId].GetWSConn() == nil {
		log.Error().Msg("error to send request answer: peer not found")
		return
	}

	h.Peers[toPeerId].SendOffer(offerPeerId, offerSdp)
}

// (h *hub) SendAnswerToPeer send answer sdp to other peer.
func (h *hub) SendAnswerToPeer(toPeerId uint32, answerPeerId uint32, answerSdp string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.Peers[toPeerId] == nil || h.Peers[toPeerId].GetWSConn() == nil {
		log.Error().Msg("error to send answer to peer: peer not found")
		return
	}

	h.Peers[toPeerId].SendAnswer(answerPeerId, answerSdp)
}
