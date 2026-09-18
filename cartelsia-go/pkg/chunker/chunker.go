package chunker

import (
	"strings"
	"unicode"
)

func SplitSentences(text string) []string {
	var sentences []string
	var current strings.Builder

	runes := []rune(text)
	n := len(runes)

	for i := 0; i < n; i++ {
		current.WriteRune(runes[i])
		if isSentenceTerminator(runes[i]) {
			if i+1 < n && isSentenceTerminator(runes[i+1]) {
				continue
			}
			if i+1 == n || unicode.IsSpace(runes[i+1]) {
				s := strings.TrimSpace(current.String())
				if s != "" {
					sentences = append(sentences, s)
				}
				current.Reset()
			}
		}
	}
	remaining := strings.TrimSpace(current.String())
	if remaining != "" {
		sentences = append(sentences, remaining)
	}
	return sentences
}

func isSentenceTerminator(r rune) bool {
	return r == '.' || r == '!' || r == '?' || r == '…'
}

func ChunkText(text string, maxChars int) []string {
	if maxChars <= 0 {
		maxChars = 500
	}
	paragraphs := strings.Split(text, "\n")
	var chunks []string
	var current strings.Builder

	for _, para := range paragraphs {
		para = strings.TrimSpace(para)
		if para == "" {
			continue
		}
		sentences := SplitSentences(para)
		for _, sent := range sentences {
			if len([]rune(sent)) > maxChars {
				words := strings.Fields(sent)
				for _, w := range words {
					if current.Len()+len(w)+1 > maxChars && current.Len() > 0 {
						chunks = append(chunks, strings.TrimSpace(current.String()))
						current.Reset()
					}
					if current.Len() > 0 {
						current.WriteString(" ")
					}
					current.WriteString(w)
				}
				continue
			}

			if current.Len()+len(sent)+1 > maxChars && current.Len() > 0 {
				chunks = append(chunks, strings.TrimSpace(current.String()))
				current.Reset()
			}
			if current.Len() > 0 {
				current.WriteString(" ")
			}
			current.WriteString(sent)
		}
	}
	if current.Len() > 0 {
		chunks = append(chunks, strings.TrimSpace(current.String()))
	}
	return chunks
}
