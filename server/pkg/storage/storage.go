package storage

import "iter"

// Storage is an interface for a generic storage.
type Storage[T any] interface {
	// Add adds a new item to the storage.
	Add(id string, data T)
	// GetAll returns all items in the storage.
	GetAll() iter.Seq[T]
	// Get returns an item from the storage by its ID.
	Get(id string) (T, error)
	// Delete deletes an item from the storage by its ID.
	Delete(id string)
	// IsEmpty returns true if the storage is empty.
	IsEmpty() bool
}
