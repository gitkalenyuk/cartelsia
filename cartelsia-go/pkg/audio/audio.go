package audio

import (
	"bytes"
	"encoding/binary"
	"math"
)

type WavOptions struct {
	SampleRate    int
	Channels      int
	BitsPerSample int
}

func WrapWav(pcm []byte, opts WavOptions) []byte {
	if opts.SampleRate == 0 {
		opts.SampleRate = 44100
	}
	if opts.Channels == 0 {
		opts.Channels = 1
	}
	if opts.BitsPerSample == 0 {
		opts.BitsPerSample = 16
	}

	byteRate := (opts.SampleRate * opts.Channels * opts.BitsPerSample) / 8
	blockAlign := (opts.Channels * opts.BitsPerSample) / 8
	dataLen := uint32(len(pcm))

	buf := new(bytes.Buffer)
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, uint32(36+dataLen))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16))
	binary.Write(buf, binary.LittleEndian, uint16(1))
	binary.Write(buf, binary.LittleEndian, uint16(opts.Channels))
	binary.Write(buf, binary.LittleEndian, uint32(opts.SampleRate))
	binary.Write(buf, binary.LittleEndian, uint32(byteRate))
	binary.Write(buf, binary.LittleEndian, uint16(blockAlign))
	binary.Write(buf, binary.LittleEndian, uint16(opts.BitsPerSample))
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, dataLen)
	buf.Write(pcm)

	return buf.Bytes()
}

func SilencePCM(ms int, opts WavOptions) []byte {
	if opts.SampleRate == 0 {
		opts.SampleRate = 44100
	}
	if opts.Channels == 0 {
		opts.Channels = 1
	}
	if opts.BitsPerSample == 0 {
		opts.BitsPerSample = 16
	}
	byteRate := (opts.SampleRate * opts.Channels * opts.BitsPerSample) / 8
	bytesCount := int(math.Round(float64(byteRate*ms) / 1000.0))
	frameSize := (opts.Channels * opts.BitsPerSample) / 8
	bytesCount -= bytesCount % frameSize
	return make([]byte, bytesCount)
}

func MergeWav(clips [][]byte, silenceMs int, opts WavOptions) []byte {
	var fullPCM []byte
	silence := SilencePCM(silenceMs, opts)

	for i, clip := range clips {
		pcm := clip
		if len(clip) >= 44 && string(clip[:4]) == "RIFF" && string(clip[8:12]) == "WAVE" {
			pcm = clip[44:]
		}
		fullPCM = append(fullPCM, pcm...)
		if i < len(clips)-1 && silenceMs > 0 {
			fullPCM = append(fullPCM, silence...)
		}
	}
	return WrapWav(fullPCM, opts)
}
