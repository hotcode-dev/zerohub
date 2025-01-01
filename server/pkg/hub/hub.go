package hub

import (
	"errors"
	"fmt"
	"strconv"
	"sync/atomic"
	"time"

	websocket "github.com/fasthttp/websocket"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	pb "github.com/hotcode-dev/zerohub/pkg/proto"
	"github.com/hotcode-dev/zerohub/pkg/storage"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
)

// TODO: add Hub timeout to disconnect all the Websockets, then clear the hub memory. (12 Hours)
type Hub interface {
	GetId() string
	GetMetadata() string
	GetCreatedAt() time.Time
	RemovePeerById(id string) (emptyPeer bool)

	HandleMessage(p peer.Peer)
	SendOfferToPeer(toPeerId string, offerPeerId string, offerSdp string)
	SendAnswerToPeer(toPeerId string, answerPeerId string, answerSdp string)

	AddPeer(p peer.Peer)
}

type hub struct {
	Id          string    `json:"id"`
	CreatedAt   time.Time `json:"createdAt"`
	Metadata    string    `json:"metadata"`
	IsPermanent bool      `json:"isPermanent"`

	CurrentPeerId atomic.Uint64              `json:"-"`
	PeerStorage   storage.Storage[peer.Peer] `json:"-"`
}

func NewHub(hubId string, metadata string, peerStorage storage.Storage[peer.Peer], isPermanent bool) (Hub, error) {
	return &hub{
		Id:          hubId,
		CreatedAt:   time.Now(),
		PeerStorage: peerStorage,
		Metadata:    metadata,
		IsPermanent: isPermanent,
	}, nil
}

// AddPeer creates a new peer and connects it to all existing peers in the mesh network.
func (h *hub) AddPeer(newPeer peer.Peer) {
	newPeer.SetId(strconv.FormatUint(h.CurrentPeerId.Add(1), 10))

	h.PeerStorage.Add(newPeer.GetId(), newPeer)

	peersProtobuf := []*pb.Peer{}

	// broadcast peer joined for all peers
	joinedSignalProto, err := CreateJoinedSignalProtobuf(newPeer.ToProtobuf())
	if err != nil {
		log.Error().Msg(err.Error())
		return
	}
	for peer := range h.PeerStorage.GetAll() {
		if peer.GetId() != newPeer.GetId() {
			peer.SendBinaryMessage(joinedSignalProto)
		}
		peersProtobuf = append(peersProtobuf, peer.ToProtobuf())
	}

	// send hub info to the new peer
	newPeer.SendHubInfo(&pb.HubInfoMessage{
		Id:          h.GetId(),
		MyPeerId:    newPeer.GetId(),
		CreatedAt:   uint32(h.GetCreatedAt().Unix()),
		Peers:       peersProtobuf,
		HubMetadata: h.GetMetadata(),
	})
}

// RemovePeerById removes a peer from the mesh network and disconnects it from all other peers.
func (h *hub) RemovePeerById(id string) (removeThisHub bool) {
	dcSignalProto, err := CreateDisconnectSignalProtobuf(id)
	if err != nil {
		log.Error().Msg(err.Error())
	}

	h.PeerStorage.Delete(id)

	// broadcast peer disconnected
	for peer := range h.PeerStorage.GetAll() {
		if peer.GetId() != id {
			peer.SendBinaryMessage(dcSignalProto)
		}
	}

	if h.IsPermanent {
		return false
	}

	// return true it has no peers left
	return h.PeerStorage.IsEmpty()
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
	if peer, err := h.PeerStorage.Get(toPeerId); peer != nil && peer.GetWSConn() != nil && err == nil {
		peer.SendOffer(offerPeerId, offerSdp)
	} else {
		log.Error().Msg("error to send request answer: peer not found")
		return
	}
}

// (h *hub) SendAnswerToPeer send answer sdp to other peer.
func (h *hub) SendAnswerToPeer(toPeerId string, answerPeerId string, answerSdp string) {
	if peer, err := h.PeerStorage.Get(toPeerId); peer != nil && peer.GetWSConn() != nil && err == nil {
		peer.SendAnswer(answerPeerId, answerSdp)
	} else {
		log.Error().Msg("error to send answer to peer: peer not found")
		return
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
			h.SendOfferToPeer(clientMessage.GetSendOfferMessage().AnswerPeerId, p.GetId(), clientMessage.GetSendOfferMessage().OfferSdp)
		case clientMessage.GetSendAnswerMessage() != nil:
			h.SendAnswerToPeer(clientMessage.GetSendAnswerMessage().OfferPeerId, p.GetId(), clientMessage.GetSendAnswerMessage().AnswerSdp)
		default:
			log.Error().Msg("invalid client message type")
		}
	}

	if exitErr != nil {
		log.Error().Err(exitErr)
	}
}
