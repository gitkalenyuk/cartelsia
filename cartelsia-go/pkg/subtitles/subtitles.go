package subtitles

import (
	"fmt"
	"strings"

	"cartelsia/pkg/models"
)

type Cue struct {
	Start float64
	End   float64
	Text  string
}

func formatTime(sec float64, sep string) string {
	if sec < 0 {
		sec = 0
	}
	ms := int(sec*1000) % 1000
	totalSec := int(sec)
	s := totalSec % 60
	m := (totalSec / 60) % 60
	h := totalSec / 3600
	return fmt.Sprintf("%02d:%02d:%02d%s%03d", h, m, s, sep, ms)
}

func BuildSRT(cues []Cue) string {
	var sb strings.Builder
	for i, c := range cues {
		sb.WriteString(fmt.Sprintf("%d\n", i+1))
		sb.WriteString(fmt.Sprintf("%s --> %s\n", formatTime(c.Start, ","), formatTime(c.End, ",")))
		sb.WriteString(c.Text + "\n\n")
	}
	return sb.String()
}

func BuildVTT(cues []Cue) string {
	var sb strings.Builder
	sb.WriteString("WEBVTT\n\n")
	for _, c := range cues {
		sb.WriteString(fmt.Sprintf("%s --> %s\n", formatTime(c.Start, "."), formatTime(c.End, ".")))
		sb.WriteString(c.Text + "\n\n")
	}
	return sb.String()
}

func CuesFromTimestamps(ts *models.WordTimestamps, offset float64) []Cue {
	if ts == nil || len(ts.Words) == 0 {
		return nil
	}
	var cues []Cue
	var currentWords []string
	start := 0.0
	end := 0.0

	flush := func() {
		if len(currentWords) > 0 {
			cues = append(cues, Cue{
				Start: start + offset,
				End:   end + offset,
				Text:  strings.Join(currentWords, " "),
			})
			currentWords = nil
		}
	}

	for i := 0; i < len(ts.Words); i++ {
		if len(currentWords) == 0 {
			start = ts.Start[i]
		}
		gap := 0.0
		if len(currentWords) > 0 {
			gap = ts.Start[i] - end
		}
		if len(currentWords) >= 7 || gap >= 0.8 {
			flush()
			start = ts.Start[i]
		}
		currentWords = append(currentWords, ts.Words[i])
		end = ts.End[i]
	}
	flush()
	return cues
}
