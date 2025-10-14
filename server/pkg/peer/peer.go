package peer

import (
	"fmt"
	"sync"
	"time"

	"github.com/fasthttp/websocket"
	pb "github.com/hotcode-dev/zerohub/pkg/proto"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
)

// Peer is an interface for a peer that is connected to a hub.
type Peer interface {
	// SendBinaryMessage sends a binary message to the peer.
	SendBinaryMessage(data []byte)
	// SendHubInfo sends a hub info message to the peer.
	SendHubInfo(hubInfoPb *pb.HubInfoMessage)
	// SendOffer sends an offer to the peer.
	SendOffer(offerPeerId string, offerSdp string)
	// SendAnswer sends an answer to the peer.
	SendAnswer(answerPeerId string, answerSdp string)
	// GetId returns the ID of the peer.
	GetId() string
	// SetId sets the ID of the peer.
	SetId(id string)
	// GetWSConn returns the websocket connection of the peer.
	GetWSConn() *websocket.Conn
	// ToProtobuf returns the protobuf representation of the peer.
	ToProtobuf() *pb.Peer
}

// peer implements the Peer interface.
type peer struct {
	// Id is the unique identifier of the peer.
	Id string `json:"id"`
	// JoinedAt is the timestamp when the peer joined.
	JoinedAt time.Time `json:"joinedAt"`
	// Metadata is the metadata associated with the peer.
	Metadata string `json:"metadata"`
	// WSConn is the websocket connection of the peer.
	WSConn *websocket.Conn `json:"-"`
	// mu is the mutex for the peer.
	mu sync.RWMutex `json:"-"`
}

// NewPeer creates a new empty Peer with no connections. Peer without adding to hub will not have an Id.
func NewPeer(ws *websocket.Conn, metadata string) Peer {
	return &peer{
		JoinedAt: time.Now(),
		WSConn:   ws,
		Metadata: metadata,
	}
}

func (p *peer) GetId() string {
	return p.Id
}

func (p *peer) GetWSConn() *websocket.Conn {
	return p.WSConn
}

func (p *peer) SetId(id string) {
	p.Id = id
}

// SendBinaryMessage sends a binary message to the peer.
func (p *peer) SendBinaryMessage(data []byte) {
	if p.WSConn == nil {
		log.Error().Err(fmt.Errorf("ws conn is nil"))
		return
	}

	// TODO: fix panic: concurrent write to websocket connection
	p.mu.Lock()
	if err := p.WSConn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		log.Error().Err(fmt.Errorf("error to send binary message: %v", err))
	}
	p.mu.Unlock()
}

func (p *peer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HubInfoMessage{
			HubInfoMessage: hubInfoPb,
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal hub info message: %v", err))
		return
	}

	p.SendBinaryMessage(data)
}

func (p *peer) SendOffer(offerPeerId string, offerSdp string) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_OfferMessage{
			OfferMessage: &pb.OfferMessage{
				OfferPeerId: offerPeerId,
				OfferSdp:    offerSdp,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal request answer message: %v", err))
		return
	}

	p.SendBinaryMessage(data)
}

func (p *peer) SendAnswer(answerPeerId string, answerSdp string) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_AnswerMessage{
			AnswerMessage: &pb.AnswerMessage{
				AnswerPeerId: answerPeerId,
				AnswerSdp:    answerSdp,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal answer message: %v", err))
		return
	}

	p.SendBinaryMessage(data)
}

func (p *peer) ToProtobuf() *pb.Peer {
	return &pb.Peer{
		Id:       p.Id,
		Metadata: p.Metadata,
		JoinedAt: uint32(p.JoinedAt.Unix()),
	}
}
