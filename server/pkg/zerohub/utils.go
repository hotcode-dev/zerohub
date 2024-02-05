package zerohub

import (
	"fmt"

	pb "github.com/hotcode-dev/zerohub/pkg/proto"
	"google.golang.org/protobuf/proto"
)

// CreateJoinedSignalProtobuf creates a protobuf message for a joined signal.
func CreateJoinedSignalProtobuf(peerProtobuf *pb.Peer) ([]byte, error) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_PeerJoined{
			PeerJoined: &pb.PeerJoinedMessage{
				Peer: peerProtobuf,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("can't marshal join signal message: %v", err)
	}

	return data, nil
}

// CreateDisconnectSignalProtobuf creates a protobuf message for a disconnect signal.
func CreateDisconnectSignalProtobuf(peerId uint32) ([]byte, error) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_PeerDisconnected{
			PeerDisconnected: &pb.PeerDisconnectedMessage{
				PeerID: peerId,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("can't marshal disconnected signal message: %v", err)
	}

	return data, nil
}
