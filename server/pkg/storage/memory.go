package storage

import (
	"errors"
	"iter"
	"sync"
)

type memoryStorage[T any] struct {
	data map[string]T

	mu sync.RWMutex
}

func NewMemoryStorage[T any]() Storage[T] {
	return &memoryStorage[T]{
		data: make(map[string]T),
	}
}

func (s *memoryStorage[T]) Add(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data[id] = data
}

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

func (s *memoryStorage[T]) Get(id string) (T, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, ok := s.data[id]; !ok {
		return s.data[id], errors.New("not found")
	}
	return s.data[id], nil
}

func (s *memoryStorage[T]) Update(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data[id] = data
}

func (s *memoryStorage[T]) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.data, id)
}

func (s *memoryStorage[T]) IsEmpty() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return len(s.data) == 0
}
