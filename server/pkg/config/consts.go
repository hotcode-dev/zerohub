package config

import "time"

const (
	HTTPMaxRequestBodySize = 4096            // 4kb
	WSHandshakeTimeout     = 5 * time.Second // 5s
	WSReadBufferSize       = 4096            // 4kb
	WSWriteBufferSize      = 4096            // 4kb
)
