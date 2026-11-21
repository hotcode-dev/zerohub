package handler

import (
	"errors"
	"strings"
	"testing"

	"github.com/fasthttp/websocket"
)

// TestWrapUpgradeErrorHandshakeError pins the first branch: a
// websocket.HandshakeError is labeled "websocket handshake" (the zero-value
// struct is constructible from outside the library because its only field
// is unexported).
func TestWrapUpgradeErrorHandshakeError(t *testing.T) {
	got := wrapUpgradeError(websocket.HandshakeError{})
	if !strings.HasPrefix(got.Error(), "websocket handshake: ") {
		t.Fatalf("got %q, want prefix %q", got.Error(), "websocket handshake: ")
	}
}

// TestWrapUpgradeErrorGenericError pins the default branch: any non-
// HandshakeError error is labeled "websocket upgrade error" and keeps the
// original message.
func TestWrapUpgradeErrorGenericError(t *testing.T) {
	got := wrapUpgradeError(errors.New("connection reset by peer"))
	want := "websocket upgrade error: connection reset by peer"
	if got.Error() != want {
		t.Fatalf("got %q, want %q", got.Error(), want)
	}
}

// TestWrapUpgradeErrorNil pins the boundary: nil is not a HandshakeError, so
// it falls through to the generic branch. Callers guard against nil today,
// but the behavior must stay stable if that guard ever moves.
func TestWrapUpgradeErrorNil(t *testing.T) {
	got := wrapUpgradeError(nil)
	if !strings.HasPrefix(got.Error(), "websocket upgrade error: ") {
		t.Fatalf("got %q, want prefix %q", got.Error(), "websocket upgrade error: ")
	}
}
