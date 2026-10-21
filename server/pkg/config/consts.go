package config

import "time"

const (
	HTTPMaxRequestBodySize = 4096 // 4kb
	// MaxMetadataSize is the application-level cap for the `id`,
	// `hubMetadata` and `peerMetadata` query parameters. These values are
	// stored in hub/peer state and re-broadcast to every peer in the hub
	// (join signal, peer roster, hub metadata), so without an intentional
	// cap a single oversized value is amplified O(N) across the hub and can
	// exhaust server memory/bandwidth. It matches HTTPMaxRequestBodySize in
	// size and intent: the client SDK sends metadata in the URI query
	// string, so the 4kb request-body limit never applies to it, and
	// fasthttp only bounds the whole request head (URL plus all headers)
	// via ReadBufferSize (default 4kb, 431 on overflow) — a transport
	// default, not a guard on any single parameter.
	MaxMetadataSize    = 4096            // 4kb
	WSHandshakeTimeout = 5 * time.Second // 5s
	WSReadBufferSize   = 4096            // 4kb
	WSWriteBufferSize  = 4096            // 4kb
	// WSIdleTimeout bounds how long a signaling connection may go
	// half-open without sending any frame. The server pings the peer
	// periodically (see handler.Upgrade) and the peer's pong — or any
	// other inbound frame — resets the deadline; on expiry the socket is
	// closed so the existing close-handling path (RemovePeerById ->
	// RemoveHubById) runs. Without this, a half-open connection (client
	// crash, NAT idle timeout, idle proxy close, mobile disconnect with no
	// FIN) blocks its ReadMessage goroutine forever, leaking one
	// goroutine + WS buffer per dead peer, and its stale roster entry is
	// re-broadcast to every later joiner for the hub's whole lifetime.
	// 60s stays generous for slow networks while staying far below typical
	// NAT/CGNAT idle-timeout windows so the probe frames keep the mapping
	// alive.
	WSIdleTimeout = 60 * time.Second
	// WSMaxFrameSize caps a single inbound WebSocket message on signaling
	// connections. After the upgrade the connection is hijacked, so
	// fasthttp's MaxRequestBodySize no longer applies and, without
	// SetReadLimit, the library would buffer an arbitrarily large binary
	// frame before proto.Unmarshal runs — a memory-exhaustion / OOM DoS.
	// 1 MiB exceeds the largest legitimate signaling payload by a wide
	// margin: the worst inbound case is a SendOffer/SendAnswer SDP blob
	// (~4-8 KiB), and the largest outbound message (HubInfo roster, with
	// each peer metadata capped at MaxMetadataSize = 4 KiB) only reaches
	// that size for hundreds of peers.
	WSMaxFrameSize = 1 << 20 // 1 MiB
)
