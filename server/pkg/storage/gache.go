package storage

import (
	"fmt"
	"iter"

	"github.com/ntsd/gache/v2"
)

type GacheStorage[T any] struct {
	GC gache.Gache[T]
}

func NewGacheStorage[T any]() Storage[T] {
	gc := gache.New[T]().DisableExpiredHook()

	return &GacheStorage[T]{
		GC: gc,
	}
}

func (s *GacheStorage[T]) Add(id string, data T) {
	s.GC.Set(id, data)
}

func (s *GacheStorage[T]) GetAll() iter.Seq[T] {
	return s.GC.RangeIterValue()
}

func (s *GacheStorage[T]) Get(id string) (T, error) {
	v, ok := s.GC.Get(id)
	if !ok {
		return v, fmt.Errorf("not found")
	}
	return v, nil
}

func (s *GacheStorage[T]) Update(id string, data T) {
	s.GC.Set(id, data)
}

func (s *GacheStorage[T]) Delete(id string) {
	s.GC.Get(id)
}

func (s *GacheStorage[T]) IsEmpty() bool {
	return s.GC.Len() == 0
}
