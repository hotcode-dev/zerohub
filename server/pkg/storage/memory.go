package storage

import (
	"errors"
	"iter"
	"sync"
)

type MemoryStorage[T any] struct {
	Data map[string]T

	mu sync.RWMutex
}

func NewMemoryStorage[T any]() Storage[T] {
	return &MemoryStorage[T]{
		Data: make(map[string]T),
	}
}

func (s *MemoryStorage[T]) Add(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Data[id] = data
}

func (s *MemoryStorage[T]) GetAll() iter.Seq[T] {
	return func(yield func(T) bool) {
		s.mu.RLock()
		defer s.mu.RUnlock()

		for _, v := range s.Data {
			if !yield(v) {
				break
			}
		}
	}
}

func (s *MemoryStorage[T]) Get(id string) (T, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, ok := s.Data[id]; !ok {
		return s.Data[id], errors.New("not found")
	}
	return s.Data[id], nil
}

func (s *MemoryStorage[T]) Update(id string, data T) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Data[id] = data
}

func (s *MemoryStorage[T]) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.Data, id)
}

func (s *MemoryStorage[T]) IsEmpty() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return len(s.Data) == 0
}
