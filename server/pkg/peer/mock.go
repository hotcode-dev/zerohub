// Code generated by MockGen. DO NOT EDIT.
// Source: ./pkg/peer/peer.go
//
// Generated by this command:
//
//	mockgen -source=./pkg/peer/peer.go -destination ./pkg/peer/mock.go -package peer -self_package github.com/hotcode-dev/zerohub/pkg/peer /pkg/peer Peer
//

// Package peer is a generated GoMock package.
package peer

import (
	reflect "reflect"

	websocket "github.com/fasthttp/websocket"
	proto "github.com/hotcode-dev/zerohub/pkg/proto"
	gomock "go.uber.org/mock/gomock"
)

// MockPeer is a mock of Peer interface.
type MockPeer struct {
	ctrl     *gomock.Controller
	recorder *MockPeerMockRecorder
	isgomock struct{}
}

// MockPeerMockRecorder is the mock recorder for MockPeer.
type MockPeerMockRecorder struct {
	mock *MockPeer
}

// NewMockPeer creates a new mock instance.
func NewMockPeer(ctrl *gomock.Controller) *MockPeer {
	mock := &MockPeer{ctrl: ctrl}
	mock.recorder = &MockPeerMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockPeer) EXPECT() *MockPeerMockRecorder {
	return m.recorder
}

// GetId mocks base method.
func (m *MockPeer) GetId() string {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetId")
	ret0, _ := ret[0].(string)
	return ret0
}

// GetId indicates an expected call of GetId.
func (mr *MockPeerMockRecorder) GetId() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetId", reflect.TypeOf((*MockPeer)(nil).GetId))
}

// GetWSConn mocks base method.
func (m *MockPeer) GetWSConn() *websocket.Conn {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetWSConn")
	ret0, _ := ret[0].(*websocket.Conn)
	return ret0
}

// GetWSConn indicates an expected call of GetWSConn.
func (mr *MockPeerMockRecorder) GetWSConn() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetWSConn", reflect.TypeOf((*MockPeer)(nil).GetWSConn))
}

// SendAnswer mocks base method.
func (m *MockPeer) SendAnswer(answerPeerId, answerSdp string) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SendAnswer", answerPeerId, answerSdp)
}

// SendAnswer indicates an expected call of SendAnswer.
func (mr *MockPeerMockRecorder) SendAnswer(answerPeerId, answerSdp any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendAnswer", reflect.TypeOf((*MockPeer)(nil).SendAnswer), answerPeerId, answerSdp)
}

// SendBinaryMessage mocks base method.
func (m *MockPeer) SendBinaryMessage(data []byte) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SendBinaryMessage", data)
}

// SendBinaryMessage indicates an expected call of SendBinaryMessage.
func (mr *MockPeerMockRecorder) SendBinaryMessage(data any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendBinaryMessage", reflect.TypeOf((*MockPeer)(nil).SendBinaryMessage), data)
}

// SendHubInfo mocks base method.
func (m *MockPeer) SendHubInfo(hubInfoPb *proto.HubInfoMessage) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SendHubInfo", hubInfoPb)
}

// SendHubInfo indicates an expected call of SendHubInfo.
func (mr *MockPeerMockRecorder) SendHubInfo(hubInfoPb any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendHubInfo", reflect.TypeOf((*MockPeer)(nil).SendHubInfo), hubInfoPb)
}

// SendOffer mocks base method.
func (m *MockPeer) SendOffer(offerPeerId, offerSdp string) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SendOffer", offerPeerId, offerSdp)
}

// SendOffer indicates an expected call of SendOffer.
func (mr *MockPeerMockRecorder) SendOffer(offerPeerId, offerSdp any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendOffer", reflect.TypeOf((*MockPeer)(nil).SendOffer), offerPeerId, offerSdp)
}

// SetId mocks base method.
func (m *MockPeer) SetId(id string) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SetId", id)
}

// SetId indicates an expected call of SetId.
func (mr *MockPeerMockRecorder) SetId(id any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SetId", reflect.TypeOf((*MockPeer)(nil).SetId), id)
}

// ToProtobuf mocks base method.
func (m *MockPeer) ToProtobuf() *proto.Peer {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "ToProtobuf")
	ret0, _ := ret[0].(*proto.Peer)
	return ret0
}

// ToProtobuf indicates an expected call of ToProtobuf.
func (mr *MockPeerMockRecorder) ToProtobuf() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "ToProtobuf", reflect.TypeOf((*MockPeer)(nil).ToProtobuf))
}
