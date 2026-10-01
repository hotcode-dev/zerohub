// Package zerohub provides the core hub management layer for the ZeroHub
// signaling server. It creates, stores, and retrieves hub instances, each
// backed by a pluggable storage implementation (in-memory or Gache).
//
// Hub Lifecycle
//  1. A new hub is created via [NewZeroHub] which selects the appropriate
//     storage backend.
//  2. Hubs are looked up by ID and removed when all peers leave.
//  3. Each hub owns its own peer storage, allowing independent peer lifecycle
//     management.
package zerohub

import (
	"fmt"
	"sync"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/storage"
)

// ZeroHub is an interface for the ZeroHub server.
type ZeroHub interface {
	// NewHub creates a new hub with the given ID and metadata.
	// If isPermanent is true, the hub never expires.
	NewHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error)
	// GetHubById returns a hub by its ID.
	GetHubById(id string) hub.Hub
	// GetOrCreateHub atomically returns the existing hub with the given ID,
	// or creates and stores a new hub if none exists. The check and the store
	// happen under a single lock, so concurrent calls with the same ID always
	// return the same hub instance. isPermanent controls hub expiry.
	GetOrCreateHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error)
	// RemoveHubById removes a hub by its ID.
	RemoveHubById(id string)
}

// zeroHub implements the ZeroHub interface.
type zeroHub struct {
	// cfg is the configuration for the ZeroHub server.
	cfg *config.Config
	// HubStorage is the storage for the hubs.
	HubStorage storage.Storage[hub.Hub]
	// mu serializes the read-then-write in GetOrCreateHub. The storage's own
	// Add is locked, but the compound check+add must be atomic, otherwise two
	// concurrent join-or-create calls for the same ID would each read a miss
	// and each store a hub, orphaning the first one.
	mu sync.Mutex
}

// NewZeroHub creates a new ZeroHub server.
func NewZeroHub(cfg *config.Config) (ZeroHub, error) {
	var hubStorage storage.Storage[hub.Hub]
	switch cfg.App.HubStorage {
	case "memory":
		hubStorage = storage.NewMemoryStorage[hub.Hub]()
	case "gache":
		hubStorage = storage.NewGacheStorage[hub.Hub]()
	default:
		return nil, fmt.Errorf("unknown hub storage: %s", cfg.App.HubStorage)
	}

	return &zeroHub{
		cfg:        cfg,
		HubStorage: hubStorage,
	}, nil
}

func (z *zeroHub) NewHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error) {
	newHub, err := z.buildHub(hubId, metadata, isPermanent)
	if err != nil {
		return nil, err
	}

	z.HubStorage.Add(hubId, newHub)

	return newHub, nil
}

// GetOrCreateHub atomically returns the existing hub with the given ID, or
// creates and stores a new one if none exists. The read and the write happen
// under z.mu, so concurrent calls for the same ID collapse to a single hub
// instead of orphaning one.
func (z *zeroHub) GetOrCreateHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error) {
	z.mu.Lock()
	defer z.mu.Unlock()

	if existing := z.GetHubById(hubId); existing != nil {
		return existing, nil
	}

	newHub, err := z.buildHub(hubId, metadata, isPermanent)
	if err != nil {
		return nil, err
	}

	z.HubStorage.Add(hubId, newHub)

	return newHub, nil
}

// buildHub constructs a hub (with its own peer storage) without storing it.
// It must be called while the caller owns the responsibility of storing the
// result, so it does not touch HubStorage.
func (z *zeroHub) buildHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error) {
	var peerStorage storage.Storage[peer.Peer]
	switch z.cfg.App.PeerStorage {
	case "memory":
		peerStorage = storage.NewMemoryStorage[peer.Peer]()
	case "gache":
		peerStorage = storage.NewGacheStorage[peer.Peer]()
	default:
		return nil, fmt.Errorf("unknown peer storage: %s", z.cfg.App.PeerStorage)
	}

	newHub, err := hub.NewHub(hubId, metadata, peerStorage, isPermanent)
	if err != nil {
		return nil, fmt.Errorf("new hub error: %w", err)
	}

	return newHub, nil
}

func (z *zeroHub) GetHubById(id string) hub.Hub {
	hub, err := z.HubStorage.Get(id)
	if err != nil {
		return nil
	}
	return hub
}

func (z *zeroHub) RemoveHubById(id string) {
	z.HubStorage.Delete(id)
}
