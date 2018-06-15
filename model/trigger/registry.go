package trigger

import (
	"fmt"
	"sync"

	"github.com/mongodb/grip"
	"github.com/mongodb/grip/message"
)

var registry = triggerRegistry{
	handlers: map[registryKey]eventHandlerFactory{},
	lock:     sync.RWMutex{},
}

type registryKey struct {
	resourceType  string
	eventDataType string
}

type triggerRegistry struct {
	handlers map[registryKey]eventHandlerFactory
	lock     sync.RWMutex
}

func (r *triggerRegistry) eventHandler(resourceType, eventDataType string) eventHandler {
	r.lock.RLock()
	defer r.lock.RUnlock()

	f, ok := r.handlers[registryKey{resourceType: resourceType, eventDataType: eventDataType}]
	if !ok {
		grip.Error(message.Fields{
			"message": "unknown event handler",
			"r_type":  resourceType,
			"cause":   "programmer error",
		})
		return nil
	}

	return f()
}

func (r *triggerRegistry) registerEventHandler(resourceType, eventData string, h eventHandlerFactory) {
	r.lock.Lock()
	defer r.lock.Unlock()

	key := registryKey{resourceType: resourceType, eventDataType: eventData}
	if _, ok := r.handlers[key]; ok {
		panic(fmt.Sprintf("tried to register an eventHandler with duplicate key '%s'", resourceType))
	}

	r.handlers[key] = h
}

func ValidateTrigger(resourceType, eventDataType, triggerName string) bool {
	h := registry.eventHandler(resourceType, eventDataType)
	if h == nil {
		return false
	}

	return h.ValidateTrigger(triggerName)
}
