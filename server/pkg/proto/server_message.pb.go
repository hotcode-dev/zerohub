// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.1
// 	protoc        v5.28.3
// source: proto/server_message.proto

package proto

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

// Peer includes peer infomation and peer metadata
type Peer struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Id            string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	Metadata      string                 `protobuf:"bytes,2,opt,name=metadata,proto3" json:"metadata,omitempty"`
	JoinedAt      uint32                 `protobuf:"varint,3,opt,name=joinedAt,proto3" json:"joinedAt,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *Peer) Reset() {
	*x = Peer{}
	mi := &file_proto_server_message_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *Peer) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Peer) ProtoMessage() {}

func (x *Peer) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Peer.ProtoReflect.Descriptor instead.
func (*Peer) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{0}
}

func (x *Peer) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *Peer) GetMetadata() string {
	if x != nil {
		return x.Metadata
	}
	return ""
}

func (x *Peer) GetJoinedAt() uint32 {
	if x != nil {
		return x.JoinedAt
	}
	return 0
}

// HubInfoMessage includes hub infomation
type HubInfoMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Id            string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	CreatedAt     uint32                 `protobuf:"varint,2,opt,name=createdAt,proto3" json:"createdAt,omitempty"`
	MyPeerId      string                 `protobuf:"bytes,3,opt,name=myPeerId,proto3" json:"myPeerId,omitempty"`
	HubMetadata   string                 `protobuf:"bytes,4,opt,name=hubMetadata,proto3" json:"hubMetadata,omitempty"`
	Peers         []*Peer                `protobuf:"bytes,5,rep,name=peers,proto3" json:"peers,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *HubInfoMessage) Reset() {
	*x = HubInfoMessage{}
	mi := &file_proto_server_message_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *HubInfoMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*HubInfoMessage) ProtoMessage() {}

func (x *HubInfoMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use HubInfoMessage.ProtoReflect.Descriptor instead.
func (*HubInfoMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{1}
}

func (x *HubInfoMessage) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *HubInfoMessage) GetCreatedAt() uint32 {
	if x != nil {
		return x.CreatedAt
	}
	return 0
}

func (x *HubInfoMessage) GetMyPeerId() string {
	if x != nil {
		return x.MyPeerId
	}
	return ""
}

func (x *HubInfoMessage) GetHubMetadata() string {
	if x != nil {
		return x.HubMetadata
	}
	return ""
}

func (x *HubInfoMessage) GetPeers() []*Peer {
	if x != nil {
		return x.Peers
	}
	return nil
}

// PeerJoinedMessage will send if a peer has joined
type PeerJoinedMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Peer          *Peer                  `protobuf:"bytes,1,opt,name=peer,proto3" json:"peer,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *PeerJoinedMessage) Reset() {
	*x = PeerJoinedMessage{}
	mi := &file_proto_server_message_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *PeerJoinedMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*PeerJoinedMessage) ProtoMessage() {}

func (x *PeerJoinedMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use PeerJoinedMessage.ProtoReflect.Descriptor instead.
func (*PeerJoinedMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{2}
}

func (x *PeerJoinedMessage) GetPeer() *Peer {
	if x != nil {
		return x.Peer
	}
	return nil
}

// PeerDisconnectedMessage will send if a peer has left
type PeerDisconnectedMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	PeerId        string                 `protobuf:"bytes,1,opt,name=peerId,proto3" json:"peerId,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *PeerDisconnectedMessage) Reset() {
	*x = PeerDisconnectedMessage{}
	mi := &file_proto_server_message_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *PeerDisconnectedMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*PeerDisconnectedMessage) ProtoMessage() {}

func (x *PeerDisconnectedMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use PeerDisconnectedMessage.ProtoReflect.Descriptor instead.
func (*PeerDisconnectedMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{3}
}

func (x *PeerDisconnectedMessage) GetPeerId() string {
	if x != nil {
		return x.PeerId
	}
	return ""
}

// OfferMessage is sent offer SDP from offering peer to answer peer
type OfferMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	OfferPeerId   string                 `protobuf:"bytes,1,opt,name=offerPeerId,proto3" json:"offerPeerId,omitempty"`
	OfferSdp      string                 `protobuf:"bytes,2,opt,name=offerSdp,proto3" json:"offerSdp,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *OfferMessage) Reset() {
	*x = OfferMessage{}
	mi := &file_proto_server_message_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *OfferMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*OfferMessage) ProtoMessage() {}

func (x *OfferMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use OfferMessage.ProtoReflect.Descriptor instead.
func (*OfferMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{4}
}

func (x *OfferMessage) GetOfferPeerId() string {
	if x != nil {
		return x.OfferPeerId
	}
	return ""
}

func (x *OfferMessage) GetOfferSdp() string {
	if x != nil {
		return x.OfferSdp
	}
	return ""
}

// AnswerMessage is sent answer SDP from answer peer to offering peer
type AnswerMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	AnswerPeerId  string                 `protobuf:"bytes,1,opt,name=answerPeerId,proto3" json:"answerPeerId,omitempty"`
	AnswerSdp     string                 `protobuf:"bytes,2,opt,name=answerSdp,proto3" json:"answerSdp,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *AnswerMessage) Reset() {
	*x = AnswerMessage{}
	mi := &file_proto_server_message_proto_msgTypes[5]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *AnswerMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*AnswerMessage) ProtoMessage() {}

func (x *AnswerMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use AnswerMessage.ProtoReflect.Descriptor instead.
func (*AnswerMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{5}
}

func (x *AnswerMessage) GetAnswerPeerId() string {
	if x != nil {
		return x.AnswerPeerId
	}
	return ""
}

func (x *AnswerMessage) GetAnswerSdp() string {
	if x != nil {
		return x.AnswerSdp
	}
	return ""
}

// IceCandidateMessage is not using yet
type IceCandidateMessage struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	PeerId        string                 `protobuf:"bytes,1,opt,name=peerId,proto3" json:"peerId,omitempty"`
	Candidate     string                 `protobuf:"bytes,2,opt,name=candidate,proto3" json:"candidate,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *IceCandidateMessage) Reset() {
	*x = IceCandidateMessage{}
	mi := &file_proto_server_message_proto_msgTypes[6]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *IceCandidateMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*IceCandidateMessage) ProtoMessage() {}

func (x *IceCandidateMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[6]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use IceCandidateMessage.ProtoReflect.Descriptor instead.
func (*IceCandidateMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{6}
}

func (x *IceCandidateMessage) GetPeerId() string {
	if x != nil {
		return x.PeerId
	}
	return ""
}

func (x *IceCandidateMessage) GetCandidate() string {
	if x != nil {
		return x.Candidate
	}
	return ""
}

// ServerMessage is the message sent from server
type ServerMessage struct {
	state protoimpl.MessageState `protogen:"open.v1"`
	// Types that are valid to be assigned to Message:
	//
	//	*ServerMessage_HubInfoMessage
	//	*ServerMessage_PeerJoinedMessage
	//	*ServerMessage_PeerDisconnectedMessage
	//	*ServerMessage_OfferMessage
	//	*ServerMessage_AnswerMessage
	//	*ServerMessage_IceCandidateMessage
	Message       isServerMessage_Message `protobuf_oneof:"message"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ServerMessage) Reset() {
	*x = ServerMessage{}
	mi := &file_proto_server_message_proto_msgTypes[7]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ServerMessage) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ServerMessage) ProtoMessage() {}

func (x *ServerMessage) ProtoReflect() protoreflect.Message {
	mi := &file_proto_server_message_proto_msgTypes[7]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ServerMessage.ProtoReflect.Descriptor instead.
func (*ServerMessage) Descriptor() ([]byte, []int) {
	return file_proto_server_message_proto_rawDescGZIP(), []int{7}
}

func (x *ServerMessage) GetMessage() isServerMessage_Message {
	if x != nil {
		return x.Message
	}
	return nil
}

func (x *ServerMessage) GetHubInfoMessage() *HubInfoMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_HubInfoMessage); ok {
			return x.HubInfoMessage
		}
	}
	return nil
}

func (x *ServerMessage) GetPeerJoinedMessage() *PeerJoinedMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_PeerJoinedMessage); ok {
			return x.PeerJoinedMessage
		}
	}
	return nil
}

func (x *ServerMessage) GetPeerDisconnectedMessage() *PeerDisconnectedMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_PeerDisconnectedMessage); ok {
			return x.PeerDisconnectedMessage
		}
	}
	return nil
}

func (x *ServerMessage) GetOfferMessage() *OfferMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_OfferMessage); ok {
			return x.OfferMessage
		}
	}
	return nil
}

func (x *ServerMessage) GetAnswerMessage() *AnswerMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_AnswerMessage); ok {
			return x.AnswerMessage
		}
	}
	return nil
}

func (x *ServerMessage) GetIceCandidateMessage() *IceCandidateMessage {
	if x != nil {
		if x, ok := x.Message.(*ServerMessage_IceCandidateMessage); ok {
			return x.IceCandidateMessage
		}
	}
	return nil
}

type isServerMessage_Message interface {
	isServerMessage_Message()
}

type ServerMessage_HubInfoMessage struct {
	HubInfoMessage *HubInfoMessage `protobuf:"bytes,1,opt,name=hubInfoMessage,proto3,oneof"`
}

type ServerMessage_PeerJoinedMessage struct {
	PeerJoinedMessage *PeerJoinedMessage `protobuf:"bytes,2,opt,name=peerJoinedMessage,proto3,oneof"`
}

type ServerMessage_PeerDisconnectedMessage struct {
	PeerDisconnectedMessage *PeerDisconnectedMessage `protobuf:"bytes,3,opt,name=peerDisconnectedMessage,proto3,oneof"`
}

type ServerMessage_OfferMessage struct {
	OfferMessage *OfferMessage `protobuf:"bytes,4,opt,name=offerMessage,proto3,oneof"`
}

type ServerMessage_AnswerMessage struct {
	AnswerMessage *AnswerMessage `protobuf:"bytes,5,opt,name=answerMessage,proto3,oneof"`
}

type ServerMessage_IceCandidateMessage struct {
	IceCandidateMessage *IceCandidateMessage `protobuf:"bytes,6,opt,name=iceCandidateMessage,proto3,oneof"`
}

func (*ServerMessage_HubInfoMessage) isServerMessage_Message() {}

func (*ServerMessage_PeerJoinedMessage) isServerMessage_Message() {}

func (*ServerMessage_PeerDisconnectedMessage) isServerMessage_Message() {}

func (*ServerMessage_OfferMessage) isServerMessage_Message() {}

func (*ServerMessage_AnswerMessage) isServerMessage_Message() {}

func (*ServerMessage_IceCandidateMessage) isServerMessage_Message() {}

var File_proto_server_message_proto protoreflect.FileDescriptor

var file_proto_server_message_proto_rawDesc = []byte{
	0x0a, 0x1a, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x73, 0x65, 0x72, 0x76, 0x65, 0x72, 0x5f, 0x6d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x22, 0x4e, 0x0a, 0x04,
	0x50, 0x65, 0x65, 0x72, 0x12, 0x0e, 0x0a, 0x02, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09,
	0x52, 0x02, 0x69, 0x64, 0x12, 0x1a, 0x0a, 0x08, 0x6d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61,
	0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x08, 0x6d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61,
	0x12, 0x1a, 0x0a, 0x08, 0x6a, 0x6f, 0x69, 0x6e, 0x65, 0x64, 0x41, 0x74, 0x18, 0x03, 0x20, 0x01,
	0x28, 0x0d, 0x52, 0x08, 0x6a, 0x6f, 0x69, 0x6e, 0x65, 0x64, 0x41, 0x74, 0x22, 0x99, 0x01, 0x0a,
	0x0e, 0x48, 0x75, 0x62, 0x49, 0x6e, 0x66, 0x6f, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12,
	0x0e, 0x0a, 0x02, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x02, 0x69, 0x64, 0x12,
	0x1c, 0x0a, 0x09, 0x63, 0x72, 0x65, 0x61, 0x74, 0x65, 0x64, 0x41, 0x74, 0x18, 0x02, 0x20, 0x01,
	0x28, 0x0d, 0x52, 0x09, 0x63, 0x72, 0x65, 0x61, 0x74, 0x65, 0x64, 0x41, 0x74, 0x12, 0x1a, 0x0a,
	0x08, 0x6d, 0x79, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x52,
	0x08, 0x6d, 0x79, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x12, 0x20, 0x0a, 0x0b, 0x68, 0x75, 0x62,
	0x4d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61, 0x18, 0x04, 0x20, 0x01, 0x28, 0x09, 0x52, 0x0b,
	0x68, 0x75, 0x62, 0x4d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61, 0x12, 0x1b, 0x0a, 0x05, 0x70,
	0x65, 0x65, 0x72, 0x73, 0x18, 0x05, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x05, 0x2e, 0x50, 0x65, 0x65,
	0x72, 0x52, 0x05, 0x70, 0x65, 0x65, 0x72, 0x73, 0x22, 0x2e, 0x0a, 0x11, 0x50, 0x65, 0x65, 0x72,
	0x4a, 0x6f, 0x69, 0x6e, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x19, 0x0a,
	0x04, 0x70, 0x65, 0x65, 0x72, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x05, 0x2e, 0x50, 0x65,
	0x65, 0x72, 0x52, 0x04, 0x70, 0x65, 0x65, 0x72, 0x22, 0x31, 0x0a, 0x17, 0x50, 0x65, 0x65, 0x72,
	0x44, 0x69, 0x73, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73,
	0x61, 0x67, 0x65, 0x12, 0x16, 0x0a, 0x06, 0x70, 0x65, 0x65, 0x72, 0x49, 0x64, 0x18, 0x01, 0x20,
	0x01, 0x28, 0x09, 0x52, 0x06, 0x70, 0x65, 0x65, 0x72, 0x49, 0x64, 0x22, 0x4c, 0x0a, 0x0c, 0x4f,
	0x66, 0x66, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x20, 0x0a, 0x0b, 0x6f,
	0x66, 0x66, 0x65, 0x72, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09,
	0x52, 0x0b, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x12, 0x1a, 0x0a,
	0x08, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x53, 0x64, 0x70, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52,
	0x08, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x53, 0x64, 0x70, 0x22, 0x51, 0x0a, 0x0d, 0x41, 0x6e, 0x73,
	0x77, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x22, 0x0a, 0x0c, 0x61, 0x6e,
	0x73, 0x77, 0x65, 0x72, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09,
	0x52, 0x0c, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x50, 0x65, 0x65, 0x72, 0x49, 0x64, 0x12, 0x1c,
	0x0a, 0x09, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x53, 0x64, 0x70, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x09, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x53, 0x64, 0x70, 0x22, 0x4b, 0x0a, 0x13,
	0x49, 0x63, 0x65, 0x43, 0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65, 0x4d, 0x65, 0x73, 0x73,
	0x61, 0x67, 0x65, 0x12, 0x16, 0x0a, 0x06, 0x70, 0x65, 0x65, 0x72, 0x49, 0x64, 0x18, 0x01, 0x20,
	0x01, 0x28, 0x09, 0x52, 0x06, 0x70, 0x65, 0x65, 0x72, 0x49, 0x64, 0x12, 0x1c, 0x0a, 0x09, 0x63,
	0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x09,
	0x63, 0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65, 0x22, 0xa6, 0x03, 0x0a, 0x0d, 0x53, 0x65,
	0x72, 0x76, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x39, 0x0a, 0x0e, 0x68,
	0x75, 0x62, 0x49, 0x6e, 0x66, 0x6f, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x01, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x0f, 0x2e, 0x48, 0x75, 0x62, 0x49, 0x6e, 0x66, 0x6f, 0x4d, 0x65, 0x73,
	0x73, 0x61, 0x67, 0x65, 0x48, 0x00, 0x52, 0x0e, 0x68, 0x75, 0x62, 0x49, 0x6e, 0x66, 0x6f, 0x4d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x42, 0x0a, 0x11, 0x70, 0x65, 0x65, 0x72, 0x4a, 0x6f,
	0x69, 0x6e, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x0b, 0x32, 0x12, 0x2e, 0x50, 0x65, 0x65, 0x72, 0x4a, 0x6f, 0x69, 0x6e, 0x65, 0x64, 0x4d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x48, 0x00, 0x52, 0x11, 0x70, 0x65, 0x65, 0x72, 0x4a, 0x6f, 0x69,
	0x6e, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x54, 0x0a, 0x17, 0x70, 0x65,
	0x65, 0x72, 0x44, 0x69, 0x73, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x65, 0x64, 0x4d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x18, 0x2e, 0x50, 0x65,
	0x65, 0x72, 0x44, 0x69, 0x73, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x65, 0x64, 0x4d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x48, 0x00, 0x52, 0x17, 0x70, 0x65, 0x65, 0x72, 0x44, 0x69, 0x73,
	0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x12, 0x33, 0x0a, 0x0c, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x0d, 0x2e, 0x4f, 0x66, 0x66, 0x65, 0x72, 0x4d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x48, 0x00, 0x52, 0x0c, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x4d, 0x65,
	0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x36, 0x0a, 0x0d, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x4d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x05, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x0e, 0x2e, 0x41,
	0x6e, 0x73, 0x77, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x48, 0x00, 0x52, 0x0d,
	0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x48, 0x0a,
	0x13, 0x69, 0x63, 0x65, 0x43, 0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65, 0x4d, 0x65, 0x73,
	0x73, 0x61, 0x67, 0x65, 0x18, 0x06, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x49, 0x63, 0x65,
	0x43, 0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x48, 0x00, 0x52, 0x13, 0x69, 0x63, 0x65, 0x43, 0x61, 0x6e, 0x64, 0x69, 0x64, 0x61, 0x74, 0x65,
	0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x42, 0x09, 0x0a, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61,
	0x67, 0x65, 0x42, 0x2a, 0x5a, 0x28, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f, 0x6d,
	0x2f, 0x68, 0x6f, 0x74, 0x63, 0x6f, 0x64, 0x65, 0x2d, 0x64, 0x65, 0x76, 0x2f, 0x7a, 0x65, 0x72,
	0x6f, 0x68, 0x75, 0x62, 0x2f, 0x70, 0x6b, 0x67, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x06,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_proto_server_message_proto_rawDescOnce sync.Once
	file_proto_server_message_proto_rawDescData = file_proto_server_message_proto_rawDesc
)

func file_proto_server_message_proto_rawDescGZIP() []byte {
	file_proto_server_message_proto_rawDescOnce.Do(func() {
		file_proto_server_message_proto_rawDescData = protoimpl.X.CompressGZIP(file_proto_server_message_proto_rawDescData)
	})
	return file_proto_server_message_proto_rawDescData
}

var file_proto_server_message_proto_msgTypes = make([]protoimpl.MessageInfo, 8)
var file_proto_server_message_proto_goTypes = []any{
	(*Peer)(nil),                    // 0: Peer
	(*HubInfoMessage)(nil),          // 1: HubInfoMessage
	(*PeerJoinedMessage)(nil),       // 2: PeerJoinedMessage
	(*PeerDisconnectedMessage)(nil), // 3: PeerDisconnectedMessage
	(*OfferMessage)(nil),            // 4: OfferMessage
	(*AnswerMessage)(nil),           // 5: AnswerMessage
	(*IceCandidateMessage)(nil),     // 6: IceCandidateMessage
	(*ServerMessage)(nil),           // 7: ServerMessage
}
var file_proto_server_message_proto_depIdxs = []int32{
	0, // 0: HubInfoMessage.peers:type_name -> Peer
	0, // 1: PeerJoinedMessage.peer:type_name -> Peer
	1, // 2: ServerMessage.hubInfoMessage:type_name -> HubInfoMessage
	2, // 3: ServerMessage.peerJoinedMessage:type_name -> PeerJoinedMessage
	3, // 4: ServerMessage.peerDisconnectedMessage:type_name -> PeerDisconnectedMessage
	4, // 5: ServerMessage.offerMessage:type_name -> OfferMessage
	5, // 6: ServerMessage.answerMessage:type_name -> AnswerMessage
	6, // 7: ServerMessage.iceCandidateMessage:type_name -> IceCandidateMessage
	8, // [8:8] is the sub-list for method output_type
	8, // [8:8] is the sub-list for method input_type
	8, // [8:8] is the sub-list for extension type_name
	8, // [8:8] is the sub-list for extension extendee
	0, // [0:8] is the sub-list for field type_name
}

func init() { file_proto_server_message_proto_init() }
func file_proto_server_message_proto_init() {
	if File_proto_server_message_proto != nil {
		return
	}
	file_proto_server_message_proto_msgTypes[7].OneofWrappers = []any{
		(*ServerMessage_HubInfoMessage)(nil),
		(*ServerMessage_PeerJoinedMessage)(nil),
		(*ServerMessage_PeerDisconnectedMessage)(nil),
		(*ServerMessage_OfferMessage)(nil),
		(*ServerMessage_AnswerMessage)(nil),
		(*ServerMessage_IceCandidateMessage)(nil),
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_proto_server_message_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   8,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_proto_server_message_proto_goTypes,
		DependencyIndexes: file_proto_server_message_proto_depIdxs,
		MessageInfos:      file_proto_server_message_proto_msgTypes,
	}.Build()
	File_proto_server_message_proto = out.File
	file_proto_server_message_proto_rawDesc = nil
	file_proto_server_message_proto_goTypes = nil
	file_proto_server_message_proto_depIdxs = nil
}
