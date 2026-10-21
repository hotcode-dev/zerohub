package handler

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/hotcode-dev/zerohub/pkg/config"
	pb "github.com/hotcode-dev/zerohub/pkg/proto/zerohub/v1"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"google.golang.org/protobuf/proto"
)

// ---- minimal WebSocket test client ----------------------------------------
//
// The handler package has no test WS-client dependency, and these tests need
// precise control (silent peers, ping-pong peers, oversized frames), so a
// minimal RFC 6455 reader/writer lives here instead of pulling in a client
// library.

// writeFrame writes one WebSocket frame to c. mask selects the RFC 6455
// client-side masking; server frames are unmasked. Callers that expect the
// write to be interrupted (e.g. the server tearing the connection down)
// must handle the returned error instead of treating it as fatal.
func writeFrame(t *testing.T, c net.Conn, mask bool, op byte, payload []byte) error {
	t.Helper()
	b1 := byte(len(payload))
	if mask {
		b1 |= 0x80
	}
	buf := make([]byte, 0, 14+len(payload))
	buf = append(buf, 0x80|op) // FIN + opcode
	switch n := len(payload); {
	case n < 126:
		buf = append(buf, b1)
	case n < 65536:
		buf = append(buf, b1, byte(n>>8), byte(n))
	default:
		buf = append(buf, b1, 0, 0, 0, 0, byte(n>>56), byte(n>>48),
			byte(n>>32), byte(n>>24), byte(n>>16), byte(n))
	}
	if mask {
		m := make([]byte, 4)
		if _, err := rand.Read(m); err != nil {
			t.Fatalf("rand mask: %v", err)
		}
		buf = append(buf, m...)
		for i, b := range payload {
			buf = append(buf, b^m[i%4])
		}
	} else {
		buf = append(buf, payload...)
	}
	// A partial write is fine: the bytes already in flight are what the
	// server sees; a write error (RST/EOF) just means the peer hung up.
	n, err := c.Write(buf)
	if err != nil && n == 0 {
		return fmt.Errorf("write frame: %v", err)
	}
	return nil
}

// wsFrame is one inbound (server->client) frame with the payload copied out.
type wsFrame struct {
	op      byte
	payload []byte
}

// readFrame reads one server->client frame. Unmasked by RFC on servers.
func readFrame(t *testing.T, c net.Conn) (wsFrame, error) {
	t.Helper()
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(c, hdr); err != nil {
		return wsFrame{}, err
	}
	op := hdr[0] & 0x0f
	n := int(hdr[1] & 0x7f)
	switch n {
	case 126:
		ext := make([]byte, 2)
		if _, err := io.ReadFull(c, ext); err != nil {
			return wsFrame{}, err
		}
		n = int(ext[0])<<8 | int(ext[1])
	case 127:
		ext := make([]byte, 8)
		if _, err := io.ReadFull(c, ext); err != nil {
			return wsFrame{}, err
		}
		if ext[0] != 0 {
			return wsFrame{}, fmt.Errorf("unsupported 64-bit frame length")
		}
		n = int(ext[1])<<56 | int(ext[2])<<48 | int(ext[3])<<32 |
			int(ext[4])<<24 | int(ext[5])<<16 | int(ext[6])<<8 | int(ext[7])
	}
	payload := make([]byte, n)
	if _, err := io.ReadFull(c, payload); err != nil {
		return wsFrame{}, err
	}
	return wsFrame{op: op, payload: payload}, nil
}

// wsCloseCode extracts the close code from a close-frame payload.
func wsCloseCode(f wsFrame) int {
	if len(f.payload) < 2 {
		return -1
	}
	return int(f.payload[0])<<8 | int(f.payload[1])
}

// dialWS connects to /v1/hubs/create?id=hubId with a raw RFC 6455 client
// handshake against the real endpoint.
func dialWS(t *testing.T, addr, hubId string) net.Conn {
	t.Helper()
	c, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_, err = c.Write([]byte("GET /v1/hubs/create?id=" + hubId +
		" HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"\r\n"))
	if err != nil {
		c.Close()
		t.Fatalf("write handshake: %v", err)
	}
	// Read the 101 Switching Protocols response (headers only; no body).
	var resp []byte
	one := make([]byte, 1)
	for {
		if _, err := c.Read(one); err != nil {
			c.Close()
			t.Fatalf("read handshake response: %v", err)
		}
		resp = append(resp, one[0])
		if len(resp) >= 4 && bytes.HasSuffix(resp, []byte("\r\n\r\n")) {
			break
		}
	}
	if !bytes.HasPrefix(resp, []byte("HTTP/1.1 101")) {
		c.Close()
		t.Fatalf("handshake response not 101: %.200q", string(resp))
	}
	return c
}

// drainUntilClosed reads frames until the connection closes (or deadline d).
// When respond is true it replies to pings with pongs like a browser; when
// false it stays completely silent — the half-open-socket simulation used by
// the reaping test. It records whether a close frame arrived and its code,
// and returns the number of pings seen.
func drainUntilClosed(t *testing.T, c net.Conn, d time.Duration, respond bool) (closeCode int, pings int) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(d))
	for {
		f, err := readFrame(t, c)
		if err != nil {
			return -1, pings
		}
		switch f.op {
		case 9: // ping
			pings++
			if respond {
				if err := writeFrame(t, c, true, 10, nil); err != nil {
					return -1, pings // the peer hung up; stop draining
				}
			}
		case 10: // pong (unexpected: we only send pings)
		case 8: // close
			return wsCloseCode(f), pings
		case 2: // binary data (e.g. a later joiner's HubInfo / signals)
		}
	}
}

// ---- test server -----------------------------------------------------------

// startSignalingTestServer serves the real static-hub create endpoint on a
// random port, so the Upgrade callback (and its keepalive goroutine +
// read-limit wiring) runs on a real connection exactly as in production.
// The handler gets short liveness timings so tests do not wait 60s. It
// returns the ZeroHub storage so tests can assert peer/hub removal directly.
func startSignalingTestServer(t *testing.T, idleTimeout, pingInterval time.Duration) (string, string, zerohub.ZeroHub) {
	t.Helper()
	hubId := fmt.Sprintf("ka-%d", time.Now().UnixNano())
	h := newTestHandler()
	zh := newRealZeroHub(t)
	h.zeroHub = zh
	// CreateHubStatic runs a cross-mode collision check against the
	// permanent and random instances, so give it real ones (a nil instance
	// would panic in rejectHubIdCollidesWithOtherModes).
	h.zeroHubPermanent = newRealZeroHub(t)
	h.zeroHubRandom = newRealZeroHub(t)
	h.wsIdleTimeout = idleTimeout
	h.wsPingInterval = pingInterval

	server := &fasthttp.Server{
		Handler: func(ctx *fasthttp.RequestCtx) {
			if string(ctx.Path()) != "/v1/hubs/create" {
				ctx.Error("unsupported path", fasthttp.StatusNotFound)
				return
			}
			_ = h.CreateHubStatic(ctx, zh)
		},
		Name:               "ZeroHub",
		MaxRequestBodySize: config.HTTPMaxRequestBodySize,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() { _ = server.Serve(ln) }()
	t.Cleanup(func() { _ = server.Shutdown() })
	return ln.Addr().String(), hubId, zh
}

// hubGone asserts that a peer was reaped: the whole hub (non-permanent,
// last peer left) is removed from storage.
func hubGone(t *testing.T, zh zerohub.ZeroHub, hubId string) {
	t.Helper()
	if got := zh.GetHubById(hubId); got != nil {
		t.Fatalf("hub %q still present in storage after peer removal, want gone (zombie leak)", hubId)
	}
}

// ---- tests -----------------------------------------------------------------

// TestWSIdlePeerIsReaped verifies liveness detection: a peer whose socket
// goes half-open (silent — no pong, no data) must be reaped within a bounded
// time instead of leaking its goroutine and its roster entry forever. The
// server closes the connection via the read-deadline path, NOT the read-limit
// path, so no close frame is expected (raw TCP close => EOF at the client).
func TestWSIdlePeerIsReaped(t *testing.T) {
	const (
		idle   = 1500 * time.Millisecond
		pingTk = 300 * time.Millisecond
	)
	addr, hubId, zh := startSignalingTestServer(t, idle, pingTk)
	c := dialWS(t, addr, hubId)
	t.Cleanup(func() { _ = c.Close() })

	// The connection must be alive initially: the hub exists in storage.
	if got := zh.GetHubById(hubId); got == nil {
		t.Fatalf("hub %q not present after join, want present", hubId)
	}

	// Consume the HubInfo that AddPeer sent on join, then go silent.
	hi, err := readFrame(t, c)
	if err != nil {
		t.Fatalf("read HubInfo frame: %v", err)
	}
	if hi.op != 2 {
		t.Fatalf("first frame op = %d, want binary (2)", hi.op)
	}

	// Wait past the idle window. The keepalive must have sent at least one
	// ping (proving it ran) and the connection must be closed by the
	// read-deadline path — a bare TCP close, not a 1009/1000 close frame.
	code, pings := drainUntilClosed(t, c, 3*time.Second, false)
	if code != -1 {
		t.Fatalf("close code = %d, want -1 (raw close, no close frame — the deadline path, not the read-limit path)", code)
	}
	if pings < 1 {
		t.Fatalf("pings = %d, want >= 1 (the keepalive must have probed before reaping)", pings)
	}
	hubGone(t, zh, hubId)
}

// TestWSActivePeerStaysConnected verifies the inverse: a live peer that
// answers the server's pings (as browsers do automatically) must NOT be
// reaped — the pong extends the read deadline on every probe.
func TestWSActivePeerStaysConnected(t *testing.T) {
	const (
		idle   = 300 * time.Millisecond
		pingTk = 100 * time.Millisecond
	)
	addr, hubId, zh := startSignalingTestServer(t, idle, pingTk)
	c := dialWS(t, addr, hubId)
	t.Cleanup(func() { _ = c.Close() })

	// Consume the HubInfo, then hold the connection open for ~4.5 idle
	// windows while replying to every ping with a pong.
	_, err := readFrame(t, c)
	if err != nil {
		t.Fatalf("read HubInfo frame: %v", err)
	}

	// Survive ~4 idle windows while answering every ping: the drain must
	// end on the client-side read deadline (still receiving), with at
	// least 2 pings observed and no close frame from the server.
	code, pings := drainUntilClosed(t, c, 1200*time.Millisecond, true)
	if code != -1 {
		t.Fatalf("server closed the live peer with close code %d within 4 idle windows, want it to stay connected", code)
	}
	if pings < 2 {
		t.Fatalf("pings = %d, want >= 2 (server must keep probing a live peer)", pings)
	}
	if got := zh.GetHubById(hubId); got == nil {
		t.Fatalf("hub %q reaped while the peer was answering pings, want still present", hubId)
	}
}

// TestWSReadLimitRejectsOversizedFrame verifies the DoS guard: an inbound
// binary frame larger than config.WSMaxFrameSize must be rejected at the
// frame header (ErrReadLimit, before any payload is buffered) and the peer
// reaped, instead of the whole frame being buffered in memory before
// proto.Unmarshal runs.
//
// The frame carries a VALID, oversized protobuf payload
// (SendIceCandidateMessage with a >1 MiB candidate string). That makes the
// assertion airtight: without SetReadLimit the library would accept and
// buffer the full frame, proto.Unmarshal would succeed, and the peer would
// stay in the hub (the test fails). With SetReadLimit the library rejects
// at the header, ReadMessage returns ErrReadLimit, and the existing
// post-loop cleanup removes the peer (the test passes).
//
// Note on the 1009 close: the library sends it "best effort" before
// tearing the connection down; on loopback the TCP teardown can race the
// client's read (RST or EOF), so the test asserts the deterministic effect
// (prompt peer removal) rather than the wire-level close code.
func TestWSReadLimitRejectsOversizedFrame(t *testing.T) {
	const idle = 5 * time.Second
	addr, hubId, zh := startSignalingTestServer(t, idle, 1500*time.Millisecond)
	c := dialWS(t, addr, hubId)
	t.Cleanup(func() { _ = c.Close() })

	// Consume the HubInfo that AddPeer sent on join.
	hi, err := readFrame(t, c)
	if err != nil {
		t.Fatalf("read HubInfo frame: %v", err)
	}
	if hi.op != 2 {
		t.Fatalf("first frame op = %d, want binary (2)", hi.op)
	}

	// A valid ClientMessage (SendIceCandidateMessage) whose marshaled size
	// exceeds the read limit: a self-targeted candidate is the largest
	// legitimate signaling payload shape, so this is a realistic worst
	// case rather than garbage.
	validOversized := func() []byte {
		b, err := proto.Marshal(&pb.ClientMessage{
			Message: &pb.ClientMessage_SendIceCandidateMessage{
				SendIceCandidateMessage: &pb.SendIceCandidateMessage{
					PeerId:    "999999",
					Candidate: strings.Repeat("x", config.WSMaxFrameSize+64),
				},
			},
		})
		if err != nil {
			t.Fatalf("marshal oversized payload: %v", err)
		}
		if int64(len(b)) <= config.WSMaxFrameSize {
			t.Fatalf("payload len = %d, want > %d", len(b), config.WSMaxFrameSize)
		}
		return b
	}()

	// The oversized frame must be rejected at the header and the peer
	// reaped promptly. The write may itself hit a RST/EOF if the server
	// tears the connection down before the client finishes writing — that
	// is still evidence of rejection, not acceptance.
	if err := writeFrame(t, c, true, 2, validOversized); err != nil {
		t.Logf("oversized frame write interrupted: %v (server likely closed the connection on the bad frame)", err)
	}
	if !waitFor(t, 3*time.Second, func() bool {
		return zh.GetHubById(hubId) == nil
	}) {
		t.Fatalf("hub %q still present 3s after oversized frame — the frame was buffered/accepted instead of rejected at the header (SetReadLimit not in effect)", hubId)
	}
}

// TestWSKeepaliveGoroutineExitsWithConnection is a regression guard for the
// keepalive goroutine outliving the upgrade callback. fasthttp recycles the
// hijacked-connection wrapper into a pool as soon as the Upgrade callback
// returns; a WriteControl on the recycled wrapper dereferences its nil
// inner conn and panics the whole server process. The goroutine therefore
// must have fully exited by the time its connection is torn down.
//
// The assertion is "the server still answers after the reaped connection's
// callback returned and several ping intervals have passed": a lingering
// goroutine would fire WriteControl on the recycled wrapper within ~one
// ping interval of the teardown and crash the process, so the server
// being responsive that long can only happen when the goroutine exited
// cleanly with its connection.
func TestWSKeepaliveGoroutineExitsWithConnection(t *testing.T) {
	const (
		idle   = 600 * time.Millisecond
		pingTk = 200 * time.Millisecond
	)
	addr, hubId, zh := startSignalingTestServer(t, idle, pingTk)
	c := dialWS(t, addr, hubId)
	t.Cleanup(func() { _ = c.Close() })

	// Consume the HubInfo that AddPeer sent on join, then go silent so the
	// peer is reaped by the idle timeout.
	if _, err := readFrame(t, c); err != nil {
		t.Fatalf("read HubInfo frame: %v", err)
	}
	if !waitFor(t, 3*time.Second, func() bool {
		return zh.GetHubById(hubId) == nil
	}) {
		t.Fatalf("hub %q not reaped after the idle window", hubId)
	}

	// Give the would-be panic several chances to fire: the next ping tick
	// after fasthttp recycled the hijacked conn is where the crash lands.
	time.Sleep(4 * pingTk)

	// The server process must still be alive and answering. Any 404 proves
	// the handler (and thus the process) is up; a crashed process yields
	// a dial/read error instead.
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial after teardown: %v — server process may have panicked", err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("GET /v1/status HTTP/1.1\r\nHost: x\r\n\r\n")); err != nil {
		t.Fatalf("write status request: %v", err)
	}
	status := make([]byte, 200)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Read(status); err != nil {
		t.Fatalf("read status response: %v — server process may have panicked", err)
	}
	if !bytes.HasPrefix(status, []byte("HTTP/1.1 4")) {
		t.Fatalf("unexpected status line after teardown: %.32q", status)
	}
}

// waitFor polls fn until it returns true or d elapses.
func waitFor(t *testing.T, d time.Duration, fn func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if fn() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fn()
}
