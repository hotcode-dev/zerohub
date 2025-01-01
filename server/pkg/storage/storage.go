package storage

import "iter"

type Storage[T any] interface {
	Add(id string, data T)
	GetAll() iter.Seq[T]
	Get(id string) (T, error)
	Update(id string, data T)
	Delete(id string)
	IsEmpty() bool
}
