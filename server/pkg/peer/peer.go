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

type Peer interface {
	SendBinaryMessage(data []byte)
	SendHubInfo(hubInfoPb *pb.HubInfoMessage)
	SendOffer(offerPeerId string, offerSdp string)
	SendAnswer(answerPeerId string, answerSdp string)

	GetId() string
	SetId(id string)
	GetWSConn() *websocket.Conn

	ToProtobuf() *pb.Peer
}

// peer represents a node in the mesh network with connections to other peers.
type peer struct {
	Id       string    `json:"id"`
	JoinedAt time.Time `json:"joinedAt"`
	Metadata string    `json:"metadata"`

	WSConn *websocket.Conn `json:"-"`

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
