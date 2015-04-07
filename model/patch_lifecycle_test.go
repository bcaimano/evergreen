package model

import (
	"10gen.com/mci/model/patch"
	"10gen.com/mci/thirdparty"
	"fmt"
	. "github.com/smartystreets/goconvey/convey"
	"io/ioutil"
	"testing"
)

var (
	projectConfig = "testdata/project.config"
	patchFile     = "testdata/patch.diff"
)

func TestMakePatchedConfig(t *testing.T) {

	Convey("With calling MakePatchedConfig with a config and remote configuration path", t, func() {
		Convey("the config should be patched correctly", func() {
			remoteConfigPath := "config/mci.yml"
			fileBytes, err := ioutil.ReadFile(patchFile)
			So(err, ShouldBeNil)
			// update patch with remove config path variable
			diffString := fmt.Sprintf(string(fileBytes),
				remoteConfigPath, remoteConfigPath, remoteConfigPath, remoteConfigPath)
			// the patch adds a new task
			p := &patch.Patch{
				Patches: []patch.ModulePatch{{
					Githash: "revision",
					PatchSet: patch.PatchSet{
						Patch: diffString,
						Summary: []thirdparty.Summary{
							thirdparty.Summary{
								Name:      remoteConfigPath,
								Additions: 3,
								Deletions: 3,
							},
						},
					},
				}},
			}
			projectBytes, err := ioutil.ReadFile(projectConfig)
			So(err, ShouldBeNil)
			project, err := MakePatchedConfig(p, remoteConfigPath, string(projectBytes))
			So(err, ShouldBeNil)
			So(project, ShouldNotBeNil)
			So(len(project.Tasks), ShouldEqual, 2)
		})
	})
}
