package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseArgsRejectsMissingRepo(t *testing.T) {
	_, err := parseArgs([]string{"checkpoints", "--json"})
	if err == nil || !strings.Contains(err.Error(), "--repo is required") {
		t.Fatalf("parseArgs error = %v, want --repo is required", err)
	}
}

func TestParseArgsParsesCheckpointExport(t *testing.T) {
	parsed, err := parseArgs([]string{"checkpoint", "export", "aaaaaaaaaaaa", "--repo", "C:/repo", "--json"})
	if err != nil {
		t.Fatalf("parseArgs returned error: %v", err)
	}

	if parsed.command != "checkpoint-export" {
		t.Fatalf("command = %q, want checkpoint-export", parsed.command)
	}
	if parsed.checkpointID != "aaaaaaaaaaaa" {
		t.Fatalf("checkpointID = %q, want aaaaaaaaaaaa", parsed.checkpointID)
	}
	if parsed.repoRoot != "C:/repo" {
		t.Fatalf("repoRoot = %q, want C:/repo", parsed.repoRoot)
	}
}

func TestBridgeListsAndExportsV1Checkpoint(t *testing.T) {
	repoRoot := createV1CheckpointRepo(t)
	source := checkpointSource{repoRoot: repoRoot}

	refs, err := source.listCheckpoints(context.Background())
	if err != nil {
		t.Fatalf("listCheckpoints returned error: %v", err)
	}
	if len(refs) != 1 {
		t.Fatalf("len(refs) = %d, want 1", len(refs))
	}

	ref := refs[0]
	if ref.CheckpointID != "aaaaaaaaaaaa" {
		t.Fatalf("CheckpointID = %q, want aaaaaaaaaaaa", ref.CheckpointID)
	}
	if ref.CheckpointFormatVersion != "v1" {
		t.Fatalf("CheckpointFormatVersion = %q, want v1", ref.CheckpointFormatVersion)
	}
	if ref.CheckpointMetadataCommitSHA == "" {
		t.Fatal("CheckpointMetadataCommitSHA is empty")
	}
	if ref.SourceWorktreeCommitSHA != nil {
		t.Fatalf("SourceWorktreeCommitSHA = %v, want nil", *ref.SourceWorktreeCommitSHA)
	}
	if len(ref.SessionIDs) != 1 || ref.SessionIDs[0] != "session-1" {
		t.Fatalf("SessionIDs = %#v, want [session-1]", ref.SessionIDs)
	}
	if ref.LatestSessionID == nil || *ref.LatestSessionID != "session-1" {
		t.Fatalf("LatestSessionID = %#v, want session-1", ref.LatestSessionID)
	}
	if ref.Agent != "codex" {
		t.Fatalf("Agent = %q, want codex", ref.Agent)
	}
	if ref.Model == nil || *ref.Model != "gpt-5" {
		t.Fatalf("Model = %#v, want gpt-5", ref.Model)
	}
	if ref.Summary == nil || *ref.Summary != "Changed the bridge" {
		t.Fatalf("Summary = %#v, want Changed the bridge", ref.Summary)
	}

	exported, err := source.exportCheckpoint(context.Background(), "aaaaaaaaaaaa")
	if err != nil {
		t.Fatalf("exportCheckpoint returned error: %v", err)
	}
	if exported.RootMetadataRef != "aa/aaaaaaaaaa/metadata.json" {
		t.Fatalf("RootMetadataRef = %q, want aa/aaaaaaaaaa/metadata.json", exported.RootMetadataRef)
	}
	if len(exported.Sessions) != 1 {
		t.Fatalf("len(exported.Sessions) = %d, want 1", len(exported.Sessions))
	}
	session := exported.Sessions[0]
	if session.MetadataRef != "aa/aaaaaaaaaa/0/metadata.json" {
		t.Fatalf("MetadataRef = %q, want aa/aaaaaaaaaa/0/metadata.json", session.MetadataRef)
	}
	if session.TranscriptRef == nil || *session.TranscriptRef != "aa/aaaaaaaaaa/0/full.jsonl" {
		t.Fatalf("TranscriptRef = %#v, want aa/aaaaaaaaaa/0/full.jsonl", session.TranscriptRef)
	}
	if session.PromptRef == nil || *session.PromptRef != "aa/aaaaaaaaaa/0/prompt.txt" {
		t.Fatalf("PromptRef = %#v, want aa/aaaaaaaaaa/0/prompt.txt", session.PromptRef)
	}
	if session.TurnID == nil || *session.TurnID != "turn-1" {
		t.Fatalf("TurnID = %#v, want turn-1", session.TurnID)
	}
}

func TestRunWritesJSON(t *testing.T) {
	repoRoot := createV1CheckpointRepo(t)
	var stdout strings.Builder

	if err := run(context.Background(), []string{"checkpoints", "--repo", repoRoot, "--json"}, &stdout, os.Stderr); err != nil {
		t.Fatalf("run returned error: %v", err)
	}

	var refs []checkpointRef
	if err := json.Unmarshal([]byte(stdout.String()), &refs); err != nil {
		t.Fatalf("stdout is not valid refs JSON: %v\n%s", err, stdout.String())
	}
	if len(refs) != 1 || refs[0].CheckpointID != "aaaaaaaaaaaa" {
		t.Fatalf("refs = %#v, want one aaaaaaaaaaaa ref", refs)
	}
}

func createV1CheckpointRepo(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	gitCmd(t, dir, "init")
	gitCmd(t, dir, "branch", "-M", "main")
	gitCmd(t, dir, "config", "user.email", "test@example.com")
	gitCmd(t, dir, "config", "user.name", "Test User")
	writeFile(t, dir, "README.md", "# test\n")
	gitCmd(t, dir, "add", "README.md")
	gitCmd(t, dir, "commit", "-m", "initial")
	gitCmd(t, dir, "switch", "--orphan", "entire/checkpoints/v1")
	gitCmd(t, dir, "rm", "-rf", "--ignore-unmatch", ".")

	writeFile(t, dir, "aa/aaaaaaaaaa/metadata.json", `{
  "checkpoint_id": "aaaaaaaaaaaa",
  "strategy": "manual-commit",
  "branch": "main",
  "checkpoints_count": 1,
  "files_touched": ["src/bridge.ts"],
  "sessions": [{
    "metadata": "/aa/aaaaaaaaaa/0/metadata.json",
    "transcript": "/aa/aaaaaaaaaa/0/full.jsonl",
    "prompt": "/aa/aaaaaaaaaa/0/prompt.txt"
  }]
}`)
	writeFile(t, dir, "aa/aaaaaaaaaa/0/metadata.json", `{
  "checkpoint_id": "aaaaaaaaaaaa",
  "session_id": "session-1",
  "strategy": "manual-commit",
  "created_at": "2026-04-26T00:00:00Z",
  "branch": "main",
  "checkpoints_count": 1,
  "files_touched": ["src/bridge.ts"],
  "agent": "codex",
  "model": "gpt-5",
  "turn_id": "turn-1",
  "summary": {
    "intent": "Connect Stoa to Entire",
    "outcome": "Changed the bridge",
    "learnings": { "repo": [], "code": [], "workflow": [] },
    "friction": [],
    "open_items": []
  },
  "initial_attribution": { "base_commit": "base-sha" }
}`)
	writeFile(t, dir, "aa/aaaaaaaaaa/0/full.jsonl", "{\"type\":\"message\"}\n")
	writeFile(t, dir, "aa/aaaaaaaaaa/0/prompt.txt", "connect entire\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "checkpoint")
	gitCmd(t, dir, "switch", "main")

	return dir
}

func writeFile(t *testing.T, root string, rel string, content string) {
	t.Helper()

	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
}

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}
