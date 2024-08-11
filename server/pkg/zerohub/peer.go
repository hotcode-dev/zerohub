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

	// 	panic: concurrent write to websocket connection

	// goroutine 107 [running]:
	// github.com/fasthttp/websocket.(*messageWriter).flushFrame(0x140000c6c18, 0x1, {0x140002eae00?, 0x0?, 0x211e?})
	//         /Users/ntsd/.asdf/installs/golang/1.22.5/packages/pkg/mod/github.com/fasthttp/websocket@v1.5.7/conn.go:672 +0x480
	// github.com/fasthttp/websocket.(*Conn).WriteMessage(0x140001d8160, 0x140002eaa00?, {0x140002eaa00, 0x211e, 0x211e})
	//         /Users/ntsd/.asdf/installs/golang/1.22.5/packages/pkg/mod/github.com/fasthttp/websocket@v1.5.7/conn.go:830 +0xfc
	// github.com/hotcode-dev/zerohub/pkg/zerohub.(*peer).SendBinaryMessage(0x100e7f3f8?, {0x140002eaa00?, 0x140002e6000?, 0x211e?})
	//         /Users/ntsd/git/hotcode/zerohub/server/pkg/zerohub/peer.go:71 +0x38
	// github.com/hotcode-dev/zerohub/pkg/zerohub.(*peer).SendOffer(0x14000288050, 0x3, {0x140002e8500, 0x2116})
	//         /Users/ntsd/git/hotcode/zerohub/server/pkg/zerohub/peer.go:151 +0x174
	// github.com/hotcode-dev/zerohub/pkg/zerohub.(*hub).SendOfferToPeer(0x140001503f0, 0x7, 0x3, {0x140002e8500, 0x2116})
	//         /Users/ntsd/git/hotcode/zerohub/server/pkg/zerohub/hub.go:144 +0x1a0
	// github.com/hotcode-dev/zerohub/pkg/zerohub.(*peer).HandleMessage(0x140000b40f0)
	//         /Users/ntsd/git/hotcode/zerohub/server/pkg/zerohub/peer.go:98 +0x134
	// github.com/hotcode-dev/zerohub/pkg/handler.(*handler).Upgrade.func1(0x1400015c2c0)
	//         /Users/ntsd/git/hotcode/zerohub/server/pkg/handler/websocket.go:31 +0x254
	// github.com/fasthttp/websocket.(*FastHTTPUpgrader).Upgrade.func1({0x100e85fd8, 0x140000be090})
	//         /Users/ntsd/.asdf/installs/golang/1.22.5/packages/pkg/mod/github.com/fasthttp/websocket@v1.5.7/server_fasthttp.go:200 +0x154
	// github.com/valyala/fasthttp.hijackConnHandler(0x1400027a008, {0x100e803c0, 0x140000b0300}, {0x100e86088, 0x14000116058}, 0x140001e2000, 0x140000ae100)
	//         /Users/ntsd/.asdf/installs/golang/1.22.5/packages/pkg/mod/github.com/valyala/fasthttp@v1.51.0/server.go:2499 +0x58
	// created by github.com/valyala/fasthttp.(*Server).serveConn in goroutine 106
	//         /Users/ntsd/.asdf/installs/golang/1.22.5/packages/pkg/mod/github.com/valyala/fasthttp@v1.51.0/server.go:2454 +0x13d8
	// exit status 2
	// make: *** [server-serve] Error 1
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
