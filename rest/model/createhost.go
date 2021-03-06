package model

import (
	"github.com/evergreen-ci/evergreen/model/host"
	"github.com/pkg/errors"
)

type CreateHost struct {
	DNSName    string `json:"dns_name"`
	InstanceID string `json:"instance_id"`
}

func (createHost *CreateHost) BuildFromService(h interface{}) error {
	switch v := h.(type) {
	case host.Host:
		createHost.DNSName = v.Host
		createHost.InstanceID = v.ExternalIdentifier
	case *host.Host:
		createHost.DNSName = v.Host
		createHost.InstanceID = v.ExternalIdentifier
	default:
		return errors.Errorf("Invalid type passed to *CreateHost.BuildFromService (%T)", h)
	}
	return nil
}

func (createHost *CreateHost) ToService() (interface{}, error) {
	return nil, errors.Errorf("ToService() is not implemented for CreateHost")
}
