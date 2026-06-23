package peer

import (
	"fmt"
	"sync"
	"time"

	"github.com/fasthttp/websocket"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Peer is an interface for a peer that is connected to a hub.
type Peer interface {
	// SendBinaryMessage sends a binary message to the peer.
	SendBinaryMessage(data []byte) error
	// SendHubInfo sends a hub info message to the peer.
	SendHubInfo(hubInfoPb *pb.HubInfoMessage) error
	// SendOffer sends an offer to the peer.
	SendOffer(offerPeerId string, offerSdp string) error
	// SendAnswer sends an answer to the peer.
	SendAnswer(answerPeerId string, answerSdp string) error
	// GetId returns the ID of the peer.
	GetId() string
	// SetId sets the ID of the peer.
	SetId(id string)
	// GetWSConn returns the websocket connection of the peer.
	GetWSConn() *websocket.Conn
	// Close closes the peer's websocket connection.
	Close()
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
	mu sync.Mutex `json:"-"`
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
func (p *peer) SendBinaryMessage(data []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.WSConn == nil {
		return fmt.Errorf("ws conn is nil")
	}

	if err := p.WSConn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		log.Error().Err(fmt.Errorf("error to send binary message: %v", err))
		return err
	}
	return nil
}

func (p *peer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) error {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HubInfoMessage{
			HubInfoMessage: hubInfoPb,
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error to marshal hub info message: %v", err))
		return err
	}

	if err := p.SendBinaryMessage(data); err != nil {
		return fmt.Errorf("error sending hub info: %w", err)
	}
	return nil
}

func (p *peer) SendOffer(offerPeerId string, offerSdp string) error {
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
		return err
	}

	if err := p.SendBinaryMessage(data); err != nil {
		return fmt.Errorf("error sending offer: %w", err)
	}
	return nil
}

func (p *peer) SendAnswer(answerPeerId string, answerSdp string) error {
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
		return err
	}

	if err := p.SendBinaryMessage(data); err != nil {
		return fmt.Errorf("error sending answer: %w", err)
	}
	return nil
}

// Close closes the peer's websocket connection by setting it to nil under the lock.
func (p *peer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.WSConn = nil
}

func (p *peer) ToProtobuf() *pb.Peer {
	return &pb.Peer{
		Id:       p.Id,
		Metadata: p.Metadata,
		JoinTime: timestamppb.New(p.JoinedAt),
	}
}
