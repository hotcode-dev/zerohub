package config

import "time"

const (
	HTTPMaxRequestBodySize = 1024            // 1kb
	WSHandshakeTimeout     = 5 * time.Second // 5s
	WSReadBufferSize       = 1024            // 1kb
	WSWriteBufferSize      = 1024            // 1kb
)
