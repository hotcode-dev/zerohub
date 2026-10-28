package storage

import (
	"errors"
	"iter"
	"sync"
)

// memoryStorage is a storage that uses memory as a backend.
type memoryStorage[T any] struct {
	// data is the map that stores the data.
	data map[string]T
	// mu is the mutex for the storage.
	mu sync.RWMutex
}

// NewMemoryStorage creates a new memory storage.
func NewMemoryStorage[T any]() Storage[T] {
	return &memoryStorage[T]{
		data: make(map[string]T),
	}
}

// Add adds a new item to the storage.
func (s *memoryStorage[T]) Add(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data[id] = data
}

// GetAll returns all items in the storage.
// The roster is snapshotted into a slice under the read lock and then
// yielded without holding it (read-copy-on-write, matching gache's
// RangeIterValue), so blocking side effects inside the iteration (e.g. the
// WebSocket writes in hub.AddPeer/RemovePeerIfLast's broadcasts) never pin the
// storage read-lock and do not serialize concurrent Get/Add/Delete/IsEmpty.
func (s *memoryStorage[T]) GetAll() iter.Seq[T] {
	s.mu.RLock()
	snapshot := make([]T, 0, len(s.data))
	for _, v := range s.data {
		snapshot = append(snapshot, v)
	}
	s.mu.RUnlock()

	return func(yield func(T) bool) {
		for _, v := range snapshot {
			if !yield(v) {
				break
			}
		}
	}
}

// Get returns an item from the storage by its ID.
func (s *memoryStorage[T]) Get(id string) (T, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, ok := s.data[id]; !ok {
		return s.data[id], errors.New("not found")
	}
	return s.data[id], nil
}

// Delete deletes an item from the storage by its ID.
func (s *memoryStorage[T]) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.data, id)
}

// IsEmpty returns true if the storage is empty.
func (s *memoryStorage[T]) IsEmpty() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return len(s.data) == 0
}
