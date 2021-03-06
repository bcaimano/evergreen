package cloud

import (
	"context"
	"fmt"
	"time"

	"github.com/evergreen-ci/evergreen"
	"github.com/evergreen-ci/evergreen/model/event"
	"github.com/evergreen-ci/evergreen/model/host"
	"github.com/mitchellh/mapstructure"
	"github.com/mongodb/anser/bsonutil"
	"github.com/mongodb/grip"
	"github.com/mongodb/grip/message"
	"github.com/pkg/errors"
)

// dockerManager implements the Manager interface for Docker.
type dockerManager struct {
	client dockerClient
}

// ProviderSettings specifies the settings used to configure a host instance.
type dockerSettings struct {
	// ImageURL is the url of the Docker image to use when building the container.
	ImageURL string `mapstructure:"image_url" json:"image_url" bson:"image_url"`
}

// nolint
var (
	// bson fields for the ProviderSettings struct
	imageURLKey = bsonutil.MustHaveTag(dockerSettings{}, "ImageURL")
)

//Validate checks that the settings from the config file are sane.
func (settings *dockerSettings) Validate() error {
	if settings.ImageURL == "" {
		return errors.New("ImageURL must not be blank")
	}

	return nil
}

// GetSettings returns an empty ProviderSettings struct.
func (*dockerManager) GetSettings() ProviderSettings {
	return &dockerSettings{}
}

// SpawnHost creates and starts a new Docker container
func (m *dockerManager) SpawnHost(ctx context.Context, h *host.Host) (*host.Host, error) {
	if h.Distro.Provider != evergreen.ProviderNameDocker {
		return nil, errors.Errorf("Can't spawn instance of %s for distro %s: provider is %s",
			evergreen.ProviderNameDocker, h.Distro.Id, h.Distro.Provider)
	}

	// Decode provider settings from distro settings
	settings := &dockerSettings{}
	if h.Distro.ProviderSettings != nil {
		if err := mapstructure.Decode(h.Distro.ProviderSettings, settings); err != nil {
			return nil, errors.Wrapf(err, "Error decoding params for distro '%s'", h.Distro.Id)
		}
	}

	// get parent of host
	parent, err := h.GetParent()
	if err != nil {
		return nil, errors.Wrapf(err, "Error finding parent of host '%s'", h.Id)
	}
	hostIP := parent.Host
	if hostIP == "" {
		return nil, errors.Wrapf(err, "Error getting host IP for parent host %s", parent.Id)
	}

	if err := settings.Validate(); err != nil {
		return nil, errors.Wrapf(err, "Invalid Docker settings for host '%s'", h.Id)
	}

	grip.Info(message.Fields{
		"message":   "decoded Docker container settings",
		"container": h.Id,
		"host_ip":   hostIP,
		"image_url": settings.ImageURL,
	})

	// Create container
	if err := m.client.CreateContainer(ctx, parent, h.Id, h.Distro.User, settings); err != nil {
		err = errors.Wrapf(err, "Failed to create container for host '%s'", hostIP)
		grip.Error(err)
		return nil, err
	}

	// Start container
	if err := m.client.StartContainer(ctx, parent, h.Id); err != nil {
		err = errors.Wrapf(err, "Docker start container API call failed for host '%s'", hostIP)
		// Clean up
		if err2 := m.client.RemoveContainer(ctx, parent, h.Id); err2 != nil {
			err = errors.Wrapf(err, "Unable to cleanup: %+v", err2)
		}
		grip.Error(err)
		return nil, err
	}

	grip.Info(message.Fields{
		"message":   "created and started Docker container",
		"container": h.Id,
	})
	event.LogHostStarted(h.Id)

	// Retrieve container details
	newContainer, err := m.client.GetContainer(ctx, parent, h.Id)
	if err != nil {
		err = errors.Wrapf(err, "Docker inspect container API call failed for host '%s'", hostIP)
		grip.Error(err)
		return nil, err
	}

	hostPort, err := retrieveOpenPortBinding(newContainer)
	if err != nil {
		err = errors.Wrapf(err, "Container '%s' could not retrieve open ports", newContainer.ID)
		grip.Error(err)
		return nil, err
	}
	h.Host = fmt.Sprintf("%s:%s", hostIP, hostPort)

	grip.Info(message.Fields{
		"message":   "retrieved open port binding",
		"container": h.Id,
		"host_ip":   hostIP,
		"host_port": hostPort,
	})

	return h, nil
}

// GetInstanceStatus returns a universal status code representing the state
// of a container.
func (m *dockerManager) GetInstanceStatus(ctx context.Context, h *host.Host) (CloudStatus, error) {
	// get parent of container host
	parent, err := h.GetParent()
	if err != nil {
		return StatusUnknown, errors.Wrapf(err, "Error retrieving parent of host '%s'", h.Id)
	}

	container, err := m.client.GetContainer(ctx, parent, h.Id)
	if err != nil {
		return StatusUnknown, errors.Wrapf(err, "Failed to get container information for host '%v'", h.Id)
	}

	return toEvgStatus(container.State), nil
}

//GetDNSName gets the DNS hostname of a container by reading it directly from
//the Docker API
func (m *dockerManager) GetDNSName(ctx context.Context, h *host.Host) (string, error) {
	if h.Host == "" {
		return "", errors.New("DNS name is empty")
	}
	return h.Host, nil
}

//TerminateInstance destroys a container.
func (m *dockerManager) TerminateInstance(ctx context.Context, h *host.Host, user string) error {
	if h.Status == evergreen.HostTerminated {
		err := errors.Errorf("Can not terminate %s - already marked as terminated!", h.Id)
		grip.Error(err)
		return err
	}

	// get parent of container host
	parent, err := h.GetParent()
	if err != nil {
		return errors.Wrapf(err, "Error retrieving parent for host '%s'", h.Id)
	}

	if err := m.client.RemoveContainer(ctx, parent, h.Id); err != nil {
		return errors.Wrap(err, "API call to remove container failed")
	}

	grip.Info(message.Fields{
		"message":   "terminated Docker container",
		"container": h.Id,
	})

	// Set the host status as terminated and update its termination time
	return h.Terminate(user)
}

//Configure populates a dockerManager by reading relevant settings from the
//config object.
func (m *dockerManager) Configure(ctx context.Context, s *evergreen.Settings) error {
	config := s.Providers.Docker

	if m.client == nil {
		m.client = &dockerClientImpl{evergreenSettings: s}
	}

	if err := m.client.Init(config.APIVersion); err != nil {
		return errors.Wrap(err, "Failed to initialize client connection")
	}

	return nil
}

//IsUp checks the container's state by querying the Docker API and
//returns true if the host should be available to connect with SSH.
func (m *dockerManager) IsUp(ctx context.Context, h *host.Host) (bool, error) {
	cloudStatus, err := m.GetInstanceStatus(ctx, h)
	if err != nil {
		return false, err
	}
	return cloudStatus == StatusRunning, nil
}

// OnUp does nothing.
func (m *dockerManager) OnUp(context.Context, *host.Host) error {
	return nil
}

//GetSSHOptions returns an array of default SSH options for connecting to a
//container.
func (m *dockerManager) GetSSHOptions(h *host.Host, keyPath string) ([]string, error) {
	if keyPath == "" {
		return []string{}, errors.New("No key specified for Docker host")
	}

	opts := []string{"-i", keyPath}
	for _, opt := range h.Distro.SSHOptions {
		opts = append(opts, "-o", opt)
	}
	return opts, nil
}

// TimeTilNextPayment returns the amount of time until the next payment is due
// for the host. For Docker this is not relevant.
func (m *dockerManager) TimeTilNextPayment(_ *host.Host) time.Duration {
	return time.Duration(0)
}

func (m *dockerManager) GetContainers(ctx context.Context, h *host.Host) ([]string, error) {
	containers, err := m.client.ListContainers(ctx, h)
	if err != nil {
		return nil, errors.Wrap(err, "error listing containers")
	}

	ids := []string{}
	for _, container := range containers {
		ids = append(ids, container.ID)
	}

	return ids, nil
}

// GetContainersRunningImage returns all the containers that are running a particular image
func (m *dockerManager) getContainersRunningImage(ctx context.Context, h *host.Host, imageID string) ([]string, error) {
	containers, err := m.GetContainers(ctx, h)
	if err != nil {
		return nil, errors.Wrap(err, "Error listing containers")
	}
	containersRunningImage := make([]string, 0)
	for _, containerID := range containers {
		container, err := m.client.GetContainer(ctx, h, containerID)
		if err != nil {
			return nil, errors.Wrapf(err, "Error getting information for container '%s'", containerID)
		}
		if container.Image == imageID {
			containersRunningImage = append(containersRunningImage, containerID)
		}
	}
	return containersRunningImage, nil
}

// RemoveOldestImage finds the oldest image without running containers and forcibly removes it
func (m *dockerManager) RemoveOldestImage(ctx context.Context, h *host.Host) error {
	// list images in order of most to least recently created
	images, err := m.client.ListImages(ctx, h)
	if err != nil {
		return errors.Wrap(err, "Error listing images")
	}

	for i := len(images) - 1; i >= 0; i-- {
		id := images[i].ID
		containersRunningImage, err := m.getContainersRunningImage(ctx, h, id)
		if err != nil {
			return errors.Wrapf(err, "Error getting containers running on image '%s'", id)
		}
		// remove image based on ID only if there are no containers running the image
		if len(containersRunningImage) == 0 {
			err = m.client.RemoveImage(ctx, h, id)
			if err != nil {
				return errors.Wrapf(err, "Error removing image '%s'", id)
			}
			return nil
		}
	}

	return nil
}

// CalculateImageSpaceUsage returns the amount of bytes that images take up on disk
func (m *dockerManager) CalculateImageSpaceUsage(ctx context.Context, h *host.Host) (int64, error) {
	images, err := m.client.ListImages(ctx, h)
	if err != nil {
		return 0, errors.Wrap(err, "Error listing images")
	}

	spaceBytes := int64(0)
	for _, image := range images {
		spaceBytes += image.Size
	}
	return spaceBytes, nil
}

// CostForDuration estimates the cost for a span of time on the given container
// host. The method divides the cost of that span on the parent host by an
// estimate of the number of containers running during the same interval.
func (m *dockerManager) CostForDuration(ctx context.Context, h *host.Host, start, end time.Time, s *evergreen.Settings) (float64, error) {
	parent, err := h.GetParent()
	if err != nil {
		return 0, errors.Wrapf(err, "Error retrieving parent for host '%s'", h.Id)
	}

	numContainers, err := parent.EstimateNumContainersForDuration(start, end)
	if err != nil {
		return 0, errors.Wrap(err, "Errors estimating number of containers running over interval")
	}

	// prevent division by zero error
	if numContainers == 0 {
		return 0, nil
	}

	// get cloud manager for parent
	parentMgr, err := GetManager(ctx, parent.Provider, s)
	if err != nil {
		return 0, errors.Wrapf(err, "Error loading provider for parent host '%s'", parent.Id)
	}

	// get parent cost for time interval
	calc, ok := parentMgr.(CostCalculator)
	if !ok {
		return 0, errors.Errorf("Type assertion failed: type %T does not hold a CostCaluclator", parentMgr)
	}
	cost, err := calc.CostForDuration(ctx, parent, start, end, s)
	if err != nil {
		return 0, errors.Wrapf(err, "Error calculating cost for parent host '%s'", parent.Id)
	}

	return cost / numContainers, nil
}
