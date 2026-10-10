package storage

import (
	"fmt"
	"iter"

	"github.com/ntsd/gache/v2"
)

// GacheStorage is a storage that uses gache as a backend.
type GacheStorage[T any] struct {
	// GC is the gache instance.
	GC gache.Gache[T]
}

// NewGacheStorage creates a new gache storage.
func NewGacheStorage[T any]() Storage[T] {
	// gache.New applies a 30s default TTL to every Set. Hub/peer entries must
	// live until the application removes them explicitly (RemovePeerById /
	// RemoveHubById), so override the default with NoTTL. Note that passing
	// gache.NoTTL as a New() option would be a no-op (WithDefaultExpiration
	// ignores dur <= 0); SetDefaultExpire writes unconditionally.
	gc := gache.New[T]().DisableExpiredHook().SetDefaultExpire(gache.NoTTL)

	return &GacheStorage[T]{
		GC: gc,
	}
}

// Add adds a new item to the storage.
func (s *GacheStorage[T]) Add(id string, data T) {
	s.GC.Set(id, data)
}

// GetAll returns all items in the storage.
func (s *GacheStorage[T]) GetAll() iter.Seq[T] {
	return s.GC.RangeIterValue()
}

// Get returns an item from the storage by its ID.
func (s *GacheStorage[T]) Get(id string) (T, error) {
	v, ok := s.GC.Get(id)
	if !ok {
		return v, fmt.Errorf("not found")
	}
	return v, nil
}

// Update updates an item in the storage.
func (s *GacheStorage[T]) Update(id string, data T) {
	s.GC.Set(id, data)
}

// Delete deletes an item from the storage by its ID.
func (s *GacheStorage[T]) Delete(id string) {
	s.GC.Delete(id)
}

// IsEmpty returns true if the storage is empty.
func (s *GacheStorage[T]) IsEmpty() bool {
	return s.GC.Len() == 0
}
