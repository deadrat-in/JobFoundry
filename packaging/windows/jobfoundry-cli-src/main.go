// Command jobfoundry is the Windows control-CLI shim for the JobFoundry MSIX
// package. The MSIX payload is read-only and the control script ships at
// usr\share\jobfoundry\windows\jobfoundry.ps1, so this tiny executable (sitting
// at the package root next to JobFoundry.exe) locates that script and forwards
// the user's arguments to an elevated-free PowerShell invocation:
//
//	jobfoundry status | start | stop | restart | logs [service] | open
//
// It is registered in the package manifest as a windows.appExecutionAlias so
// the command works from any terminal after install. Cross-compiled for
// windows/amd64 on the Linux build host with CGO disabled, so it has no
// runtime or DLL dependencies.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "jobfoundry: cannot resolve executable path: %v\n", err)
		os.Exit(1)
	}
	root := filepath.Dir(exe)

	ps1 := filepath.Join(root, "usr", "share", "jobfoundry", "windows", "jobfoundry.ps1")
	if _, err := os.Stat(ps1); err != nil {
		fmt.Fprintf(os.Stderr, "jobfoundry: missing bundled file: %s\n", ps1)
		os.Exit(1)
	}

	args := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1}
	args = append(args, os.Args[1:]...)
	cmd := exec.Command("powershell.exe", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "jobfoundry: failed to run control script: %v\n", err)
		os.Exit(1)
	}
}