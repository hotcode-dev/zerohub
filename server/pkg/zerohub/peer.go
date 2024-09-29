package zerohub

import (
	"errors"
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
	HandleMessage()
	SendHubInfo(peersProtobuf []*pb.Peer)
	SendOffer(offerPeerId uint32, offerSdp string)
	SendAnswer(answerPeerId uint32, answerSdp string)

	GetId() uint32
	SetId(id uint32)
	SetHub(hub Hub)
	GetWSConn() *websocket.Conn

	ToProtobuf() *pb.Peer
}

// peer represents a node in the mesh network with connections to other peers.
type peer struct {
	Id       uint32    `json:"id"`
	JoinedAt time.Time `json:"joinedAt"`
	Metadata string    `json:"metadata"`

	Hub    Hub             `json:"-"`
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

func (p *peer) GetId() uint32 {
	return p.Id
}

func (p *peer) GetWSConn() *websocket.Conn {
	return p.WSConn
}

func (p *peer) SetId(id uint32) {
	p.Id = id
}

func (p *peer) SetHub(hub Hub) {
	p.Hub = hub
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

func (p *peer) HandleMessage() {
	var exitErr error
	for {
		wsMsgType, message, err := p.WSConn.ReadMessage()
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
			p.Hub.SendOfferToPeer(clientMessage.GetSendOfferMessage().AnswerPeerId, p.Id, clientMessage.GetSendOfferMessage().OfferSdp)
		case clientMessage.GetSendAnswerMessage() != nil:
			p.Hub.SendAnswerToPeer(clientMessage.GetSendAnswerMessage().OfferPeerId, p.Id, clientMessage.GetSendAnswerMessage().AnswerSdp)
		default:
			log.Error().Msg("invalid client message type")
		}
	}

	if exitErr != nil {
		log.Error().Err(exitErr)
	}
}

func (p *peer) SendHubInfo(peersProtobuf []*pb.Peer) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HubInfoMessage{
			HubInfoMessage: &pb.HubInfoMessage{
				Id:          p.Hub.GetId(),
				MyPeerId:    p.Id,
				CreatedAt:   uint32(p.Hub.GetCreatedAt().Unix()),
				Peers:       peersProtobuf,
				HubMetadata: p.Hub.GetMetadata(),
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal hub info message: %v", err))
		return
	}

	p.SendBinaryMessage(data)
}

func (p *peer) SendOffer(offerPeerId uint32, offerSdp string) {
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

func (p *peer) SendAnswer(answerPeerId uint32, answerSdp string) {
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
