import React, { useRef, useState } from "react";
import { View } from "react-native";
import type { Chore, ChoreCompletion } from "./core";
import { today, validDate } from "./core";
import { uid } from "./backend";
import { useStore } from "./store";
import {
  choreCatalog,
  choreFrequencies,
  choreAssignee,
  choreCompletionPreview,
  lastChoreCompletion,
} from "./chores";
import { Button, Chip, Field, Sheet, Title, Txt, C, s } from "./ui";
export default function ChoreTracker() {
  const st = useStore(),
    active = st.members.filter((m) => !m.left_at),
    self = active.find((m) => m.user_id === st.user?.id);
  const [view, setView] = useState("Upcoming"),
    [adding, setAdding] = useState(false),
    [custom, setCustom] = useState(false),
    [editing, setEditing] = useState<Chore | null>(null),
    [name, setName] = useState(""),
    [catalogId, setCatalogId] = useState<string | null>(null),
    [frequency, setFrequency] = useState<Chore["frequency"]>("Weekly"),
    [mode, setMode] = useState<Chore["assignment_mode"]>("fixed"),
    [roster, setRoster] = useState<string[]>([]),
    [assigned, setAssigned] = useState(""),
    [due, setDue] = useState(today()),
    [query, setQuery] = useState(""),
    [logging, setLogging] = useState<Chore | null>(null),
    [date, setDate] = useState(today()),
    [archive, setArchive] = useState<Chore | null>(null),
    [undo, setUndo] = useState<ChoreCompletion | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    draftId = useRef(""),
    completionId = useRef("");
  const member = (id: string) =>
    st.members.find((m) => m.id === id)?.name || "Former roommate";
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    if (!lock.current) {
      setAdding(false);
      setLogging(null);
      setArchive(null);
      setUndo(null);
      setError("");
    }
  };
  const start = (isCustom: boolean, item?: Chore) => {
    setEditing(item || null);
    draftId.current = item?.id || uid();
    setCustom(isCustom);
    setName(item?.name || "");
    setCatalogId(item?.catalog_id || null);
    setFrequency(item?.frequency || "Weekly");
    setMode(item?.assignment_mode || "fixed");
    setRoster(
      item?.member_ids.filter((id) => active.some((m) => m.id === id)) || [],
    );
    setAssigned(item?.assigned_to || "");
    setDue(item?.next_due_date || today());
    setQuery("");
    setError("");
    setAdding(true);
  };
  const toggle = (id: string) => {
    if (mode === "fixed") {
      setRoster([id]);
      setAssigned(id);
    } else {
      const next = roster.includes(id)
        ? roster.filter((x) => x !== id)
        : [...roster, id];
      setRoster(next);
      if (!next.includes(assigned)) setAssigned(next[0] || "");
    }
  };
  const save = () =>
    run(async () => {
      await st.saveChore({
        id: draftId.current,
        household_id: st.household!.id,
        catalog_id: catalogId,
        name,
        frequency,
        assignment_mode: mode,
        member_ids: roster,
        assigned_to: assigned,
        next_due_date: due,
        archived: editing?.archived || false,
        version: editing?.version || 0,
        created_at: editing?.created_at || new Date().toISOString(),
      });
      setAdding(false);
    });
  const chores = st.chores
    .filter((c) => c.archived === (view === "Archived"))
    .sort(
      (a, b) =>
        a.next_due_date.localeCompare(b.next_due_date) ||
        a.name.localeCompare(b.name),
    );
  const history = [...st.choreCompletions].sort(
    (a, b) =>
      b.completed_on.localeCompare(a.completed_on) ||
      b.created_at.localeCompare(a.created_at),
  );
  let preview: ReturnType<typeof choreCompletionPreview> | null = null;
  try {
    if (logging && self && validDate(date))
      preview = choreCompletionPreview(
        logging,
        date,
        self.id,
        st.members,
        st.choreCompletions,
      );
  } catch {}
  const errorView = error ? (
    <Txt style={{ color: C.red }} accessibilityRole="alert">
      {error}
    </Txt>
  ) : null;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Title>Chore Tracker</Title>
        <Txt muted>A little teamwork. A happier home.</Txt>
      </View>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Button label="Add chore" icon="Plus" onPress={() => start(false)} />
        <Button label="Custom chore" secondary onPress={() => start(true)} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {["Upcoming", "Completion history", "Archived"].map((v) => (
          <Chip
            key={v}
            label={v}
            active={view === v}
            onPress={() => {
              setView(v);
              setError("");
            }}
          />
        ))}
      </View>
      {!adding && !logging && !archive && !undo && errorView}
      {view === "Completion history" ? (
        <View style={{ gap: 12 }}>
          {!history.length && (
            <Txt muted>
              No completions yet. Log a chore to give your household a little
              credit.
            </Txt>
          )}
          {history.map((entry) => {
            const item = st.chores.find((c) => c.id === entry.chore_id);
            return (
              <View key={entry.id} style={[s.card, { gap: 8 }]}>
                <Txt bold>
                  {entry.chore_name}
                  {entry.voided_at ? " · Undone" : ""}
                </Txt>
                <Txt>
                  {member(entry.completed_by)} completed this on{" "}
                  {entry.completed_on}.
                </Txt>
                <Txt muted>
                  {entry.frequency} ·{" "}
                  {entry.assignment_mode === "fixed"
                    ? "Fixed member"
                    : "Taking turns"}
                  {!entry.advanced_schedule
                    ? " · Earlier completion; schedule unchanged"
                    : ""}
                </Txt>
                {!entry.voided_at &&
                  entry.recorded_by === st.user?.id &&
                  item?.version === entry.after_version && (
                    <Button
                      label="Undo my completion"
                      secondary
                      small
                      onPress={() => {
                        setUndo(entry);
                        setError("");
                      }}
                    />
                  )}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {!chores.length && (
            <View style={[s.card, { gap: 8 }]}>
              <Txt bold>
                {view === "Archived"
                  ? "No archived chores"
                  : "Make room for teamwork"}
              </Txt>
              <Txt muted>
                {view === "Archived"
                  ? "Archived chores keep their completion history."
                  : "Choose from your household’s 19 suggested chores or add a custom chore. Set a schedule and decide whose turn comes first."}
              </Txt>
            </View>
          )}
          {chores.map((item) => {
            const assignee = choreAssignee(item, st.members),
              last = lastChoreCompletion(item.id, st.choreCompletions);
            return (
              <View key={item.id} style={[s.card, { gap: 10 }]}>
                <Txt bold style={{ fontSize: 18 }}>
                  {item.name}
                </Txt>
                <Txt>
                  {item.frequency} ·{" "}
                  {item.assignment_mode === "fixed"
                    ? "Fixed member"
                    : "Taking turns"}
                </Txt>
                <Txt
                  style={{
                    color:
                      !item.archived && item.next_due_date < today()
                        ? C.red
                        : C.green,
                  }}
                >
                  {item.next_due_date < today()
                    ? "Overdue"
                    : item.next_due_date === today()
                      ? "Due today"
                      : "Next due"}{" "}
                  · {item.next_due_date}
                </Txt>
                <Txt>
                  {assignee
                    ? `Assigned to ${member(assignee)}`
                    : "Needs reassignment — member left"}
                </Txt>
                {item.assignment_mode === "rotate" && (
                  <Txt muted>
                    Rotation:{" "}
                    {item.member_ids
                      .filter((id) => active.some((m) => m.id === id))
                      .map(member)
                      .join(" → ")}
                  </Txt>
                )}
                {last && (
                  <Txt muted>
                    Last completed by {member(last.completed_by)} ·{" "}
                    {last.completed_on}
                  </Txt>
                )}
                <View
                  style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                >
                  {!item.archived && (
                    <Button
                      label="Log completion"
                      accessibilityLabel={`Log completion for ${item.name}`}
                      small
                      disabled={!assignee}
                      onPress={() => {
                        setLogging(item);
                        setDate(today());
                        completionId.current = uid();
                        setError("");
                      }}
                    />
                  )}
                  <Button
                    label="Edit"
                    accessibilityLabel={`Edit ${item.name}`}
                    secondary
                    small
                    onPress={() => start(!item.catalog_id, item)}
                  />
                  <Button
                    label={item.archived ? "Restore" : "Archive"}
                    accessibilityLabel={`${item.archived ? "Restore" : "Archive"} ${item.name}`}
                    secondary
                    small
                    onPress={() => {
                      setArchive(item);
                      setError("");
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
      {adding && (
        <Sheet
          title={editing ? "Edit chore" : custom ? "Custom chore" : "Add chore"}
          onClose={close}
        >
          {!custom && !editing && !catalogId && (
            <>
              <Field
                label="Find a chore"
                value={query}
                onChangeText={setQuery}
              />
              <Txt muted>From your Chore Chart spreadsheet · 19 chores</Txt>
              <View style={{ gap: 7 }}>
                {choreCatalog
                  .filter((c) =>
                    c.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      active={catalogId === c.id}
                      onPress={() => {
                        setCatalogId(c.id);
                        setName(c.name);
                      }}
                    />
                  ))}
              </View>
            </>
          )}
          {!custom && !editing && catalogId && (
            <Button
              label="Choose a different chore"
              secondary
              small
              onPress={() => {
                setCatalogId(null);
                setName("");
              }}
            />
          )}
          {custom ? (
            <Field
              label="Chore name"
              value={name}
              onChangeText={setName}
              maxLength={120}
            />
          ) : (
            <Txt bold>{name || "Choose a chore above"}</Txt>
          )}
          <Txt bold>How often?</Txt>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {choreFrequencies.map((f) => (
              <Chip
                key={f}
                label={f}
                active={frequency === f}
                onPress={() => setFrequency(f)}
              />
            ))}
          </View>
          <Txt bold>Who takes care of it?</Txt>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip
              label="Fixed member"
              active={mode === "fixed"}
              onPress={() => {
                setMode("fixed");
                setRoster(roster.slice(0, 1));
                setAssigned(roster[0] || "");
              }}
            />
            <Chip
              label="Take turns"
              active={mode === "rotate"}
              onPress={() => setMode("rotate")}
            />
          </View>
          <Txt muted>
            {mode === "fixed"
              ? "This member stays assigned until your household edits the chore."
              : "Choose at least two roommates. Selection order sets the rotation."}
          </Txt>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {active.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                active={roster.includes(m.id)}
                onPress={() => toggle(m.id)}
              />
            ))}
          </View>
          {mode === "rotate" && roster.length > 0 && (
            <>
              <Txt muted>Rotation: {roster.map(member).join(" → ")}</Txt>
              <Txt bold>Whose turn is first?</Txt>
              <View style={{ gap: 7 }}>
                {roster.map((id) => (
                  <Chip
                    key={id}
                    label={`First: ${member(id)}`}
                    active={assigned === id}
                    onPress={() => setAssigned(id)}
                  />
                ))}
              </View>
            </>
          )}
          <Field
            label="Next due date (YYYY-MM-DD)"
            value={due}
            onChangeText={setDue}
          />
          <Txt muted>
            After completion, the next due date is counted from the day it was
            completed. Biweekly means every 14 days; monthly means the same day
            next month, or its last day.
          </Txt>
          {errorView}
          <Button label="Save chore" loading={busy} onPress={save} />
        </Sheet>
      )}
      {logging && (
        <Sheet title="Log chore completion" onClose={close}>
          <Txt bold>{logging.name}</Txt>
          <Txt>
            Recording as {self?.name}. You can help with another roommate’s
            turn.
          </Txt>
          <Field
            label="Completed on (YYYY-MM-DD)"
            value={date}
            onChangeText={setDate}
          />
          {preview && (
            <Txt muted>
              {preview.advances
                ? `Next: ${member(preview.assigned_to)} · due ${preview.next_due_date}`
                : "This is an earlier completion. The upcoming assignment and due date will stay the same."}
            </Txt>
          )}
          {errorView}
          <Button
            label="Save completion"
            loading={busy}
            onPress={() =>
              run(async () => {
                await st.logChore(logging, date, completionId.current);
                setLogging(null);
              })
            }
          />
        </Sheet>
      )}
      {archive && (
        <Sheet
          title={archive.archived ? "Restore chore?" : "Archive chore?"}
          onClose={close}
        >
          <Txt>
            {archive.archived
              ? "This chore will return to Upcoming."
              : "This chore will leave Upcoming. All completion history will be kept."}
          </Txt>
          {errorView}
          <Button
            label={archive.archived ? "Restore chore" : "Archive chore"}
            loading={busy}
            onPress={() =>
              run(async () => {
                await st.setChoreArchived(archive, !archive.archived);
                setArchive(null);
              })
            }
          />
        </Sheet>
      )}
      {undo && (
        <Sheet title="Undo your completion?" onClose={close}>
          <Txt>
            This restores the previous assignment and due date. The original
            record stays in history and is labeled Undone.
          </Txt>
          {errorView}
          <Button
            label="Confirm undo"
            loading={busy}
            onPress={() =>
              run(async () => {
                await st.undoChore(undo);
                setUndo(null);
              })
            }
          />
        </Sheet>
      )}
    </View>
  );
}
