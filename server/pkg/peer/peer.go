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

// WSConn is an interface for WebSocket connections, allowing mocking in tests.
type WSConn interface {
	WriteMessage(msgType int, data []byte) error
	ReadMessage() (msgType int, data []byte, err error)
	Close() error
}

// Peer is an interface for a peer that is connected to a hub.
type Peer interface {
	// SendBinaryMessage sends a binary message to the peer.
	SendBinaryMessage(data []byte)
	// SendHubInfo sends the hub info message to the peer.
	SendHubInfo(hubInfoPb *pb.HubInfoMessage)
	// SendOffer sends an SDP offer to the peer.
	SendOffer(offerPeerId string, offerSdp string)
	// SendAnswer sends an SDP answer to the peer.
	SendAnswer(answerPeerId string, answerSdp string)
	// GetId returns the peer's unique identifier.
	GetId() string
	// SetId assigns the peer's unique identifier.
	SetId(id string)
	// GetWSConn returns the underlying WebSocket connection.
	GetWSConn() WSConn
	// ToProtobuf returns the peer as a protobuf Peer message.
	ToProtobuf() *pb.Peer
	// Close shuts down the write-loop goroutine.
	Close()
}

// writeOp represents a single write operation.
type writeOp struct {
	data []byte
	done chan struct{} // closed when the write is done
}

// peer implements the Peer interface.
type peer struct {
	// Id is the unique identifier of the peer.
	Id string `json:"id"`
	// JoinedAt is the timestamp when the peer joined the hub.
	JoinedAt time.Time `json:"joinedAt"`
	// Metadata carries arbitrary JSON payload sent by the client on connect.
	Metadata string `json:"metadata"`
	// WSConn is the WebSocket connection for this peer.
	WSConn WSConn `json:"-"`
	// mu guards WSConn for nil-checks and updates.
	mu sync.RWMutex `json:"-"`

	// writeChan serializes all concurrent writes into a single goroutine,
	// preventing fasthttp/websocket from panicking on concurrent calls.
	writeChan chan writeOp
	// closeChan signals the write loop to stop.
	closeChan chan struct{}
	// wg waits for the write loop to finish.
	wg sync.WaitGroup
}

// NewPeer creates a peer and starts a single write-loop goroutine.
func NewPeer(ws WSConn, metadata string) Peer {
	p := &peer{
		JoinedAt:  time.Now(),
		WSConn:    ws,
		Metadata:  metadata,
		writeChan: make(chan writeOp, 64),
		closeChan: make(chan struct{}),
	}
	p.wg.Add(1)
	go p.writeLoop()
	return p
}

func (p *peer) GetId() string {
	return p.Id
}

func (p *peer) GetWSConn() WSConn {
	return p.WSConn
}

func (p *peer) SetId(id string) {
	p.Id = id
}

// SendBinaryMessage sends binary data over the WebSocket.
// It is safe for concurrent calls — each call creates a writeOp with its own
// done channel, so callers block until the single write-loop goroutine has
// actually written that message.  This eliminates the concurrent-write panic
// that the fasthttp/websocket library exhibits when multiple goroutines call
// WriteMessage simultaneously.
func (p *peer) SendBinaryMessage(data []byte) {
	if p.WSConn == nil {
		log.Error().Err(fmt.Errorf("ws conn is nil")).Str("peerId", p.Id).Msg("SendBinaryMessage")
		return
	}

	done := make(chan struct{})
	p.writeChan <- writeOp{data: data, done: done}
	<-done // block until the write loop finishes this message
}

func (p *peer) SendHubInfo(hubInfoPb *pb.HubInfoMessage) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HubInfoMessage{
			HubInfoMessage: hubInfoPb,
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		log.Error().Err(fmt.Errorf("error marshalling hub info: %v", err)).Str("peerId", p.Id).Msg("SendHubInfo")
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
		log.Error().Err(fmt.Errorf("error marshalling offer: %v", err)).Str("peerId", p.Id).Msg("SendOffer")
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
		log.Error().Err(fmt.Errorf("error marshalling answer: %v", err)).Str("peerId", p.Id).Msg("SendAnswer")
		return
	}

	p.SendBinaryMessage(data)
}

// writeLoop is a single goroutine that serializes all writes to the WebSocket.
// This prevents concurrent write panics from fasthttp/websocket which is not
// safe for concurrent calls.
func (p *peer) writeLoop() {
	defer p.wg.Done()
	for {
		select {
		case op := <-p.writeChan:
			if p.WSConn == nil {
				close(op.done)
				continue
			}
			if err := p.WSConn.WriteMessage(websocket.BinaryMessage, op.data); err != nil {
				log.Error().Err(fmt.Errorf("error sending binary message: %v", err)).Str("peerId", p.Id).Msg("writeLoop")
			}
			close(op.done)
		case <-p.closeChan:
			return
		}
	}
}

// Close shuts down the write-loop goroutine and waits for it to finish.
func (p *peer) Close() {
	close(p.closeChan)
	p.wg.Wait()
}

func (p *peer) ToProtobuf() *pb.Peer {
	return &pb.Peer{
		Id:       p.Id,
		Metadata: p.Metadata,
		JoinTime: timestamppb.New(p.JoinedAt),
	}
}
