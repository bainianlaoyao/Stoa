package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/entireio/cli/cmd/entire/cli/checkpoint"
	"github.com/entireio/cli/cmd/entire/cli/checkpoint/id"
	"github.com/entireio/cli/cmd/entire/cli/paths"
	"github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/plumbing"
)

type parsedArgs struct {
	command      string
	repoRoot     string
	checkpointID string
}

type checkpointRef struct {
	CheckpointID                string   `json:"checkpoint_id"`
	CheckpointFormatVersion    string   `json:"checkpoint_format_version"`
	CheckpointMetadataCommitSHA string   `json:"checkpoint_metadata_commit_sha"`
	SourceWorktreeCommitSHA    *string  `json:"source_worktree_commit_sha"`
	SessionIDs                  []string `json:"session_ids"`
	LatestSessionID            *string  `json:"latest_session_id"`
	Agent                       string   `json:"agent"`
	Model                       *string  `json:"model"`
	Summary                     *string  `json:"summary"`
	CreatedAt                   *string  `json:"created_at"`
	UpdatedAt                   *string  `json:"updated_at"`
}

type checkpointExport struct {
	CheckpointID                string          `json:"checkpoint_id"`
	CheckpointFormatVersion    string          `json:"checkpoint_format_version"`
	CheckpointMetadataCommitSHA string          `json:"checkpoint_metadata_commit_sha"`
	SourceWorktreeCommitSHA    *string         `json:"source_worktree_commit_sha"`
	RootMetadataRef            string          `json:"root_metadata_ref"`
	Sessions                   []sessionExport `json:"sessions"`
	TokenUsage                 unknownJSON     `json:"token_usage"`
	CombinedAttribution        unknownJSON     `json:"combined_attribution"`
}

type sessionExport struct {
	SessionID          string      `json:"session_id"`
	Agent              string      `json:"agent"`
	Model              *string     `json:"model"`
	TurnID             *string     `json:"turn_id"`
	MetadataRef        string      `json:"metadata_ref"`
	TranscriptRef      *string     `json:"transcript_ref"`
	PromptRef          *string     `json:"prompt_ref"`
	Summary            *string     `json:"summary"`
	InitialAttribution unknownJSON `json:"initial_attribution"`
}

type unknownJSON = any

type checkpointSource struct {
	repoRoot string
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer, _ io.Writer) error {
	parsed, err := parseArgs(args)
	if err != nil {
		return err
	}

	source := checkpointSource{repoRoot: parsed.repoRoot}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")

	switch parsed.command {
	case "checkpoints":
		refs, listErr := source.listCheckpoints(ctx)
		if listErr != nil {
			return listErr
		}
		return encoder.Encode(refs)
	case "checkpoint-export":
		exported, exportErr := source.exportCheckpoint(ctx, parsed.checkpointID)
		if exportErr != nil {
			return exportErr
		}
		return encoder.Encode(exported)
	default:
		return fmt.Errorf("unsupported command %q", parsed.command)
	}
}

func parseArgs(args []string) (parsedArgs, error) {
	if len(args) == 0 {
		return parsedArgs{}, errors.New("usage: entire-bridge checkpoints --repo <path> --json")
	}

	parsed := parsedArgs{}
	switch {
	case args[0] == "checkpoints":
		parsed.command = "checkpoints"
		args = args[1:]
	case len(args) >= 3 && args[0] == "checkpoint" && args[1] == "export":
		parsed.command = "checkpoint-export"
		parsed.checkpointID = args[2]
		args = args[3:]
	default:
		return parsedArgs{}, fmt.Errorf("unsupported command: %s", strings.Join(args, " "))
	}

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--repo":
			if i+1 >= len(args) {
				return parsedArgs{}, errors.New("--repo requires a path")
			}
			parsed.repoRoot = args[i+1]
			i++
		case "--json":
		default:
			return parsedArgs{}, fmt.Errorf("unsupported flag: %s", args[i])
		}
	}

	if parsed.repoRoot == "" {
		return parsedArgs{}, errors.New("--repo is required")
	}
	if parsed.command == "checkpoint-export" && parsed.checkpointID == "" {
		return parsedArgs{}, errors.New("checkpoint id is required")
	}

	return parsed, nil
}

func (s checkpointSource) listCheckpoints(ctx context.Context) ([]checkpointRef, error) {
	repo, err := openRepo(s.repoRoot)
	if err != nil {
		return nil, err
	}

	metadataSHA, err := metadataCommitSHA(repo)
	if err != nil {
		return nil, err
	}

	store := checkpoint.NewGitStore(repo)
	committed, err := store.ListCommitted(ctx)
	if err != nil {
		return nil, err
	}

	refs := make([]checkpointRef, 0, len(committed))
	for _, item := range committed {
		summary, readErr := store.ReadCommitted(ctx, item.CheckpointID)
		if readErr != nil {
			return nil, readErr
		}
		if summary == nil {
			continue
		}

		sessionMetadatas := make([]*checkpoint.CommittedMetadata, 0, len(summary.Sessions))
		for i := range summary.Sessions {
			metadata, metadataErr := store.ReadSessionMetadata(ctx, item.CheckpointID, i)
			if metadataErr == nil {
				sessionMetadatas = append(sessionMetadatas, metadata)
			}
		}

		refs = append(refs, toCheckpointRef(item.CheckpointID, metadataSHA, sessionMetadatas))
	}

	return refs, nil
}

func (s checkpointSource) exportCheckpoint(ctx context.Context, checkpointID string) (*checkpointExport, error) {
	repo, err := openRepo(s.repoRoot)
	if err != nil {
		return nil, err
	}

	metadataSHA, err := metadataCommitSHA(repo)
	if err != nil {
		return nil, err
	}

	cpID, err := id.NewCheckpointID(checkpointID)
	if err != nil {
		return nil, err
	}

	store := checkpoint.NewGitStore(repo)
	summary, err := store.ReadCommitted(ctx, cpID)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, fmt.Errorf("checkpoint %q not found", checkpointID)
	}

	sessions := make([]sessionExport, 0, len(summary.Sessions))
	for i, refs := range summary.Sessions {
		metadata, metadataErr := store.ReadSessionMetadata(ctx, cpID, i)
		if metadataErr != nil {
			return nil, metadataErr
		}
		sessions = append(sessions, toSessionExport(metadata, refs))
	}

	return &checkpointExport{
		CheckpointID:                cpID.String(),
		CheckpointFormatVersion:    "v1",
		CheckpointMetadataCommitSHA: metadataSHA,
		SourceWorktreeCommitSHA:    nil,
		RootMetadataRef:            path.Join(cpID.Path(), paths.MetadataFileName),
		Sessions:                   sessions,
		TokenUsage:                 summary.TokenUsage,
		CombinedAttribution:        summary.CombinedAttribution,
	}, nil
}

func openRepo(repoRoot string) (*git.Repository, error) {
	repo, err := git.PlainOpenWithOptions(repoRoot, &git.PlainOpenOptions{DetectDotGit: true})
	if err != nil {
		return nil, fmt.Errorf("failed to open git repository %q: %w", repoRoot, err)
	}
	return repo, nil
}

func metadataCommitSHA(repo *git.Repository) (string, error) {
	ref, err := repo.Reference(plumbing.NewBranchReferenceName(paths.MetadataBranchName), true)
	if err != nil {
		return "", fmt.Errorf("failed to read %s: %w", paths.MetadataBranchName, err)
	}
	return ref.Hash().String(), nil
}

func toCheckpointRef(
	checkpointID id.CheckpointID,
	metadataSHA string,
	sessionMetadatas []*checkpoint.CommittedMetadata,
) checkpointRef {
	var latestSessionID *string
	var model *string
	var summaryText *string
	var createdAt *string
	agent := ""

	sessionIDs := make([]string, 0, len(sessionMetadatas))
	for _, metadata := range sessionMetadatas {
		if metadata.SessionID != "" {
			sessionIDs = append(sessionIDs, metadata.SessionID)
		}
	}

	var latest *checkpoint.CommittedMetadata
	if len(sessionMetadatas) > 0 {
		latest = sessionMetadatas[len(sessionMetadatas)-1]
	}
	if latest != nil {
		agent = string(latest.Agent)
		latestSessionID = stringPtr(latest.SessionID)
		if latest.Model != "" {
			model = stringPtr(latest.Model)
		}
		if latest.Summary != nil {
			summaryText = summaryToText(latest.Summary)
		}
		if !latest.CreatedAt.IsZero() {
			value := latest.CreatedAt.Format("2006-01-02T15:04:05Z07:00")
			createdAt = &value
		}
	}

	return checkpointRef{
		CheckpointID:                checkpointID.String(),
		CheckpointFormatVersion:    "v1",
		CheckpointMetadataCommitSHA: metadataSHA,
		SourceWorktreeCommitSHA:    nil,
		SessionIDs:                  sessionIDs,
		LatestSessionID:            latestSessionID,
		Agent:                      agent,
		Model:                      model,
		Summary:                    summaryText,
		CreatedAt:                  createdAt,
		UpdatedAt:                  nil,
	}
}

func toSessionExport(metadata *checkpoint.CommittedMetadata, refs checkpoint.SessionFilePaths) sessionExport {
	return sessionExport{
		SessionID:          metadata.SessionID,
		Agent:              string(metadata.Agent),
		Model:              emptyStringAsNil(metadata.Model),
		TurnID:             emptyStringAsNil(metadata.TurnID),
		MetadataRef:        trimTreePath(refs.Metadata),
		TranscriptRef:      emptyStringAsNil(trimTreePath(refs.Transcript)),
		PromptRef:          emptyStringAsNil(trimTreePath(refs.Prompt)),
		Summary:            summaryToText(metadata.Summary),
		InitialAttribution: metadata.InitialAttribution,
	}
}

func summaryToText(summary *checkpoint.Summary) *string {
	if summary == nil {
		return nil
	}
	if summary.Outcome != "" {
		return stringPtr(summary.Outcome)
	}
	if summary.Intent != "" {
		return stringPtr(summary.Intent)
	}
	return nil
}

func trimTreePath(value string) string {
	return strings.TrimPrefix(value, "/")
}

func emptyStringAsNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringPtr(value string) *string {
	return &value
}
