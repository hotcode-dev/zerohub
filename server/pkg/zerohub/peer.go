package zerohub

import (
	"errors"
	"fmt"
	"time"

	"github.com/fasthttp/websocket"
	pb "github.com/ntsd/zero-hub/server/pkg/proto"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
)

type Peer interface {
	SendBinaryMessage(data []byte)
	HandleMessage()
	SendHubInfo(peersProtobuf []*pb.Peer)
	SendOffer(offerPeerID uint32, offerSDP string)
	SendAnswer(answerPeerID uint32, answerSDP string)

	GetID() uint32
	SetID(id uint32)
	SetHub(hub Hub)
	GetWSConn() *websocket.Conn

	ToProtobuf() *pb.Peer
}

// peer represents a node in the mesh network with connections to other peers.
type peer struct {
	ID       uint32
	JoinedAt time.Time
	MetaData string

	Hub    Hub
	WSConn *websocket.Conn
}

// NewPeer creates a new empty Peer with no connections. Peer without adding to hub will not have an ID.
func NewPeer(ws *websocket.Conn, metaData string) Peer {
	return &peer{
		JoinedAt: time.Now(),
		WSConn:   ws,
		MetaData: metaData,
	}
}

func (p *peer) GetID() uint32 {
	return p.ID
}

func (p *peer) GetWSConn() *websocket.Conn {
	return p.WSConn
}

func (p *peer) SetID(id uint32) {
	p.ID = id
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

	if err := p.WSConn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		log.Error().Err(fmt.Errorf("error to send binary message: %v", err))
	}
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
		case clientMessage.GetOfferMessage() != nil:
			p.Hub.SendOfferToPeer(clientMessage.GetOfferMessage().AnswerPeerID, p.ID, clientMessage.GetOfferMessage().OfferSDP)
		case clientMessage.GetAnswerMessage() != nil:
			p.Hub.SendAnswerToPeer(clientMessage.GetAnswerMessage().OfferPeerID, p.ID, clientMessage.GetAnswerMessage().AnswerSDP)
		default:
			log.Error().Msg("invalid client message type")
		}
	}

	if exitErr != nil {
		log.Error().Err(exitErr)
		if err := p.WSConn.WriteMessage(websocket.CloseMessage, []byte(exitErr.Error())); err != nil {
			log.Error().Err(fmt.Errorf("error write close message: %v", err))
			return
		}
	}
}

func (p *peer) SendHubInfo(peersProtobuf []*pb.Peer) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HubInfoMessage{
			HubInfoMessage: &pb.HubInfoMessage{
				Id:        p.Hub.GetID(),
				MyPeerID:  p.ID,
				CreatedAt: uint32(p.Hub.GetCreatedAt().Unix()),
				Peers:     peersProtobuf,
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

func (p *peer) SendOffer(offerPeerID uint32, offerSDP string) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_OfferMessage{
			OfferMessage: &pb.OfferMessage{
				OfferPeerID: offerPeerID,
				OfferSDP:    offerSDP,
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

func (p *peer) SendAnswer(answerPeerID uint32, answerSDP string) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_AnswerMessage{
			AnswerMessage: &pb.AnswerMessage{
				AnswerPeerID: answerPeerID,
				AnswerSDP:    answerSDP,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal request accept message: %v", err))
		return
	}

	p.SendBinaryMessage(data)
}

func (p *peer) ToProtobuf() *pb.Peer {
	return &pb.Peer{
		Id:       p.ID,
		MetaData: p.MetaData,
		JoinedAt: uint32(p.JoinedAt.Unix()),
	}
}
