// Core algorithm: correlates Deepgram diarization labels (SPEAKER_0, SPEAKER_1)
// with real participant names observed from the Google Meet DOM.
//
// Strategy:
//   1. Content script sends speaker_start / speaker_end events with {name, timestampMs}
//   2. Deepgram sends transcript segments with {speaker: "SPEAKER_0", start_ms, end_ms}
//   3. We find DOM events that overlap the segment's time window
//   4. If exactly one person was speaking during that window → assign label to name
//   5. Once a label is assigned, all future (and past) segments get that name

export interface DomSpeakerEvent {
  name: string;
  startMs: number;
  endMs: number | null; // null = still speaking
}

export interface TranscriptSegment {
  segmentId: string;
  speakerLabel: string;   // "SPEAKER_0"
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  words?: WordData[];
}

export interface WordData {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface IdentifiedSegment extends TranscriptSegment {
  speakerName: string | null;
}

export class SpeakerCorrelator {
  // Permanent mapping once identified: "SPEAKER_0" → "John Smith"
  private labelToName = new Map<string, string>();

  // Sliding window of DOM events (keep last 60 seconds)
  private domEvents: DomSpeakerEvent[] = [];
  private openEvents = new Map<string, DomSpeakerEvent>(); // name → open event

  // For logging unresolved segments to retry later
  private unresolvedSegments: TranscriptSegment[] = [];

  // All participants seen via participant_known events
  private knownParticipants: string[] = [];

  // Tolerance: DOM events can lag audio by up to this many ms
  private readonly TOLERANCE_MS = 800;

  onSpeakerIdentified?: (label: string, name: string) => void;

  // Called when content.js fires speaker_start
  domSpeakerStart(name: string, timestampMs: number): void {
    if (this.openEvents.has(name)) {
      // Close stale open event
      const stale = this.openEvents.get(name)!;
      stale.endMs = timestampMs;
    }

    const event: DomSpeakerEvent = { name, startMs: timestampMs, endMs: null };
    this.openEvents.set(name, event);
    this.domEvents.push(event);

    // Retry any segments that couldn't be resolved before
    this.retryUnresolved();
    this.pruneOldEvents();
  }

  // Called when content.js fires speaker_end
  domSpeakerEnd(name: string, timestampMs: number): void {
    const event = this.openEvents.get(name);
    if (event) {
      event.endMs = timestampMs;
      this.openEvents.delete(name);
    }
  }

  // Close all open events (meeting ended)
  closeAllEvents(timestampMs: number): void {
    for (const event of this.openEvents.values()) {
      event.endMs = timestampMs;
    }
    this.openEvents.clear();
  }

  // Register a known participant — if only one speaker label exists, auto-assign
  registerParticipant(name: string): void {
    if (!this.knownParticipants.includes(name)) {
      this.knownParticipants.push(name)
    }
    if ([...this.labelToName.values()].includes(name)) return
    const unlabelledSpeakers = [...new Set(
      this.unresolvedSegments.map(s => s.speakerLabel)
    )].filter(label => !this.labelToName.has(label))
    if (unlabelledSpeakers.length === 1) {
      const label = unlabelledSpeakers[0]
      this.labelToName.set(label, name)
      console.log(`[correlator] Auto-assigned ${label} → "${name}" (only unresolved speaker)`)
      this.onSpeakerIdentified?.(label, name)
      this.resolveBacklog(label, name)
    }
    this.tryEliminationAssignment()
  }

  // Main method: given a Deepgram segment, return it with speaker name if known
  // wallOffset: add to segment timestamps before comparing with DOM events (wall-clock).
  // For Meet (per-track) this is always 0. For Zoom mixed audio, pass firstAudioWallMs.
  correlate(segment: TranscriptSegment, wallOffset = 0): IdentifiedSegment {
    const label = segment.speakerLabel;

    // Already have a confirmed mapping
    if (this.labelToName.has(label)) {
      return { ...segment, speakerName: this.labelToName.get(label)! };
    }

    // Try to identify from DOM events using wall-clock-adjusted timestamps
    const name = this.findMatchingDomSpeaker(
      segment.startMs + wallOffset,
      segment.endMs + wallOffset
    );

    if (name) {
      this.labelToName.set(label, name);
      console.log(`[correlator] Identified ${label} → "${name}"`);
      this.onSpeakerIdentified?.(label, name);

      // Also resolve any previously unresolved segments with same label
      this.resolveBacklog(label, name);

      return { ...segment, speakerName: name };
    }

    // Cannot resolve yet — queue for retry (store wallOffset so retry uses same offset)
    this.unresolvedSegments.push({ ...segment, _wallOffset: wallOffset } as any);
    this.tryEliminationAssignment();
    return { ...segment, speakerName: null };
  }

  // Returns map of all known label→name assignments
  getKnownSpeakers(): Map<string, string> {
    return new Map(this.labelToName);
  }

  // Resolve a specific label for all backlogged segments
  private resolveBacklog(label: string, name: string): void {
    this.unresolvedSegments = this.unresolvedSegments.filter(seg => {
      if (seg.speakerLabel === label) {
        this.onSpeakerIdentified?.(label, name);
        return false; // remove from unresolved
      }
      return true;
    });
  }

  private retryUnresolved(): void {
    if (this.unresolvedSegments.length === 0) return;

    const stillUnresolved: TranscriptSegment[] = [];

    for (const seg of this.unresolvedSegments) {
      if (this.labelToName.has(seg.speakerLabel)) {
        // Already resolved in a previous pass
        continue;
      }

      const wallOffset = (seg as any)._wallOffset ?? 0;
      const name = this.findMatchingDomSpeaker(
        seg.startMs + wallOffset,
        seg.endMs + wallOffset
      );
      if (name) {
        this.labelToName.set(seg.speakerLabel, name);
        this.onSpeakerIdentified?.(seg.speakerLabel, name);
        console.log(`[correlator] Retroactively identified ${seg.speakerLabel} → "${name}"`);
      } else {
        stillUnresolved.push(seg);
      }
    }

    this.unresolvedSegments = stillUnresolved;
  }

  private tryEliminationAssignment(): void {
    const unresolvedLabels = [...new Set(
      this.unresolvedSegments.map(s => s.speakerLabel)
    )].filter(label => !this.labelToName.has(label));

    if (unresolvedLabels.length !== 1) return;

    const assignedNames = new Set(this.labelToName.values());
    const unassignedParticipants = this.knownParticipants.filter(
      n => !assignedNames.has(n)
    );

    if (unassignedParticipants.length === 1) {
      const label = unresolvedLabels[0];
      const name = unassignedParticipants[0];
      this.labelToName.set(label, name);
      console.log(`[correlator] Elimination-assigned ${label} → "${name}"`);
      this.onSpeakerIdentified?.(label, name);
      this.resolveBacklog(label, name);
    }
  }

  private findMatchingDomSpeaker(startMs: number, endMs: number): string | null {
    const low = startMs - this.TOLERANCE_MS;
    const high = endMs + this.TOLERANCE_MS;

    const overlapping = this.domEvents.filter(ev => {
      const evEnd = ev.endMs ?? high + 1; // still speaking → treat as extending
      return ev.startMs <= high && evEnd >= low;
    });

    // Exactly one person was speaking during this segment = confident match
    const uniqueNames = [...new Set(overlapping.map(e => e.name))];
    if (uniqueNames.length === 1) {
      return uniqueNames[0];
    }

    // Multiple candidates: pick the one with highest overlap duration
    if (uniqueNames.length > 1) {
      let bestName: string | null = null;
      let bestOverlap = 0;

      for (const name of uniqueNames) {
        const events = overlapping.filter(e => e.name === name);
        const totalOverlap = events.reduce((sum, ev) => {
          const evStart = Math.max(ev.startMs, low);
          const evEnd = Math.min(ev.endMs ?? high, high);
          return sum + Math.max(0, evEnd - evStart);
        }, 0);

        if (totalOverlap > bestOverlap) {
          bestOverlap = totalOverlap;
          bestName = name;
        }
      }

      // Only use best-overlap match if it's clearly dominant (>60% of window)
      const windowSize = high - low;
      if (bestName && bestOverlap / windowSize > 0.6) {
        return bestName;
      }
    }

    return null;
  }

  private pruneOldEvents(): void {
    // Keep only events from the last 60 seconds
    const cutoff = Date.now() - 60_000;
    this.domEvents = this.domEvents.filter(
      ev => (ev.endMs ?? Date.now()) > cutoff
    );
  }
}
