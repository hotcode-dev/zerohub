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
func (s *memoryStorage[T]) GetAll() iter.Seq[T] {
	return func(yield func(T) bool) {
		s.mu.RLock()
		defer s.mu.RUnlock()

		for _, v := range s.data {
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

// Update updates an item in the storage.
func (s *memoryStorage[T]) Update(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data[id] = data
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
