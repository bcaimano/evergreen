package route

import (
	"context"
	"net/http"

	"github.com/evergreen-ci/evergreen/rest/data"
	"github.com/evergreen-ci/evergreen/rest/model"
	"github.com/pkg/errors"
)

type distroGetHandler struct{}

func getDistroRouteManager(route string, version int) *RouteManager {
	return &RouteManager{
		Route: route,
		Methods: []MethodHandler{
			{
				Authenticator:  &RequireUserAuthenticator{},
				RequestHandler: &distroGetHandler{},
				MethodType:     http.MethodGet,
			},
		},
		Version: version,
	}
}

func (dgh *distroGetHandler) Handler() RequestHandler {
	return &distroGetHandler{}
}

func (dgh *distroGetHandler) ParseAndValidate(ctx context.Context, r *http.Request) error {
	return nil
}

func (dgh *distroGetHandler) Execute(ctx context.Context, sc data.Connector) (ResponseData, error) {
	distros, err := sc.FindAllDistros()
	if err != nil {
		return ResponseData{}, errors.Wrap(err, "Database error")
	}
	models := make([]model.Model, len(distros))
	for i, d := range distros {
		distroModel := &model.APIDistro{}
		if err := distroModel.BuildFromService(d); err != nil {
			return ResponseData{}, err
		}
		models[i] = distroModel
	}

	return ResponseData{
		Result: models,
	}, nil
}
