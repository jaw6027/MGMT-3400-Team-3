import { useRef, useState } from "react";
import { View } from "react-native";
import { uid } from "./backend";
import { useStore } from "./store";
import {
  inactiveTemplateMembers,
  validateSplitTemplate,
  type SplitTemplate,
} from "./splitTemplates";
import { Button, C, Chip, Field, Title, Txt, s } from "./ui";

export function SplitTemplates({
  purchaseAllocations,
  onApply,
}: {
  purchaseAllocations: SplitTemplate["allocations"] | null;
  onApply: (allocations: SplitTemplate["allocations"]) => void;
}) {
  const { household, members, splitTemplates, changeSplitTemplate } =
    useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SplitTemplate | null>(null);
  const [deleting, setDeleting] = useState<SplitTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const active = members.filter((member) => !member.left_at);
  const activeAllocations = (allocations: SplitTemplate["allocations"]) =>
    allocations.filter((entry) =>
      active.some((member) => member.id === entry.member_id),
    );
  const savedTemplate =
    draft && splitTemplates.find((template) => template.id === draft.id);
  const editingFormerRoommate =
    savedTemplate &&
    inactiveTemplateMembers(savedTemplate.allocations, members).length > 0;

  const start = (template?: SplitTemplate) => {
    if (!household) return;
    setError("");
    setNotice("");
    setDraft(
      template
        ? { ...template, allocations: activeAllocations(template.allocations) }
        : {
            id: uid(),
            household_id: household.id,
            name: "",
            version: 0,
            allocations: purchaseAllocations
              ? activeAllocations(purchaseAllocations)
              : active.map(({ id }) => ({ member_id: id, percentage: "" })),
          },
    );
  };

  const submit = async (template: SplitTemplate, remove: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await changeSplitTemplate(
        remove ? template : validateSplitTemplate(template, members),
        remove,
      );
      setDraft(null);
      setDeleting(null);
      setNotice(remove ? "Template deleted." : "Template saved.");
    } catch (e) {
      setError((e as Error).message || "Could not update the template.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
        <Title style={{ fontSize: 19 }}>Split templates</Title>
        <Chip
          label={open ? "Hide templates" : "Show templates"}
          active={open}
          onPress={() => {
            if (busy) return;
            setOpen(!open);
          }}
        />
      </View>
      {open && (
        <>
          {!draft && !deleting && (
            <>
              {[...splitTemplates]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((template) => {
                  const unavailable =
                    inactiveTemplateMembers(template.allocations, members)
                      .length > 0;
                  return (
                    <View
                      key={template.id}
                      style={{
                        gap: 8,
                        padding: 10,
                        borderWidth: 1,
                        borderColor: C.line,
                        borderRadius: 9,
                      }}
                    >
                      <Txt style={{ fontFamily: "DMBold" }}>
                        {template.name}
                      </Txt>
                      {unavailable && (
                        <Txt style={s.muted}>
                          Edit this template before using it. A roommate is no
                          longer in the household.
                        </Txt>
                      )}
                      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
                        <Button
                          small
                          secondary
                          label="Use"
                          accessibilityLabel={`Use template ${template.name}`}
                          disabled={unavailable}
                          onPress={() => {
                            setError("");
                            onApply(template.allocations);
                            setNotice(
                              `Applied ${template.name} to this purchase.`,
                            );
                          }}
                        />
                        <Button
                          small
                          secondary
                          label="Edit"
                          accessibilityLabel={`Edit template ${template.name}`}
                          onPress={() => start(template)}
                        />
                        <Button
                          small
                          secondary
                          label="Delete"
                          accessibilityLabel={`Delete template ${template.name}`}
                          onPress={() => {
                            setNotice("");
                            setError("");
                            setDeleting(template);
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              <Button
                small
                secondary
                label="New template"
                onPress={() => start()}
              />
            </>
          )}
          {draft && (
            <>
              <Field
                label="Template name"
                value={draft.name}
                maxLength={80}
                editable={!busy}
                onChangeText={(name: string) => setDraft({ ...draft, name })}
              />
              {editingFormerRoommate && (
                <Txt style={s.muted}>
                  Former roommates have been removed from this draft. Adjust the
                  percentages to total 100%.
                </Txt>
              )}
              <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
                {active.map(({ id, name }) => {
                  const selected = draft.allocations.some(
                    ({ member_id }) => member_id === id,
                  );
                  return (
                    <Chip
                      key={id}
                      label={name}
                      active={selected}
                      onPress={() => {
                        if (busy) return;
                        setDraft({
                          ...draft,
                          allocations: selected
                            ? draft.allocations.filter(
                                ({ member_id }) => member_id !== id,
                              )
                            : [
                                ...draft.allocations,
                                { member_id: id, percentage: "" },
                              ],
                        });
                      }}
                    />
                  );
                })}
              </View>
              {draft.allocations.map(({ member_id, percentage }) => (
                <Field
                  key={member_id}
                  label={`${active.find(({ id }) => id === member_id)?.name || "Roommate"} template percentage`}
                  keyboardType="decimal-pad"
                  value={percentage}
                  editable={!busy}
                  onChangeText={(value: string) =>
                    setDraft({
                      ...draft,
                      allocations: draft.allocations.map((entry) =>
                        entry.member_id === member_id
                          ? { ...entry, percentage: value }
                          : entry,
                      ),
                    })
                  }
                />
              ))}
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button
                  small
                  label="Save template"
                  loading={busy}
                  onPress={() => void submit(draft, false)}
                />
                <Button
                  small
                  secondary
                  label="Cancel"
                  disabled={busy}
                  onPress={() => {
                    setError("");
                    setDraft(null);
                  }}
                />
              </View>
            </>
          )}
          {deleting && (
            <>
              <Txt>
                Delete “{deleting.name}” from this household’s templates?
              </Txt>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button
                  small
                  danger
                  label="Delete template"
                  loading={busy}
                  onPress={() => void submit(deleting, true)}
                />
                <Button
                  small
                  secondary
                  label="Cancel"
                  disabled={busy}
                  onPress={() => {
                    setError("");
                    setDeleting(null);
                  }}
                />
              </View>
            </>
          )}
          {!!error && (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {error}
            </Txt>
          )}
          {!!notice && (
            <Txt accessibilityLiveRegion="polite" style={s.muted}>
              {notice}
            </Txt>
          )}
        </>
      )}
    </View>
  );
}
