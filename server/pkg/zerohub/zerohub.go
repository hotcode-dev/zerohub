package zerohub

import (
	"fmt"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/storage"
)

type ZeroHub interface {
	NewHub(hubId string, metadata string, isPermanent bool) (hub.Hub, error)
	GetHubById(id string) hub.Hub
	RemoveHubById(id string)
}

type zeroHub struct {
	cfg *config.Config

	HubStorage storage.Storage[hub.Hub]
}

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

	z.HubStorage.Add(hubId, newHub)

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
