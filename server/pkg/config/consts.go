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
	// fasthttp's MaxHeaderBytes bounds the entire request head (URL plus
	// all headers), not a single parameter.
	MaxMetadataSize    = 4096            // 4kb
	WSHandshakeTimeout = 5 * time.Second // 5s
	WSReadBufferSize   = 4096            // 4kb
	WSWriteBufferSize  = 4096            // 4kb
)
