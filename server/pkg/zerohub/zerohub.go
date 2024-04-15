package zerohub

import (
	"sync"

	"github.com/hotcode-dev/zerohub/pkg/config"
)

type ZeroHub interface {
	AddHub(hub Hub)
	GetHubById(id string) Hub
	RemoveHubById(id string)
}

type zeroHub struct {
	cfg *config.Config

	Hubs map[string]Hub

	// TODO: do we need mutex since Hub Id are unique?
	mu sync.RWMutex
}

func NewZeroHub(cfg *config.Config) (ZeroHub, error) {
	return &zeroHub{
		cfg:  cfg,
		Hubs: make(map[string]Hub),
	}, nil
}

func (z *zeroHub) AddHub(hub Hub) {
	hub.SetZeroHub(z)

	z.mu.Lock()
	defer z.mu.Unlock()

	z.Hubs[hub.GetId()] = hub
}

func (z *zeroHub) GetHubById(id string) Hub {
	z.mu.RLock()
	defer z.mu.RUnlock()

	return z.Hubs[id]
}

func (z *zeroHub) RemoveHubById(id string) {
	z.mu.RLock()
	defer z.mu.RUnlock()

	delete(z.Hubs, id)
}
