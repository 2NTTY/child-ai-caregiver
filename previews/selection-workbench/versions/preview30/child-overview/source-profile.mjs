// Presentation-only models. The formal ChildProfile and transport stay authoritative.
export const profileAgeOptions = [
    { value: "unknown", label: "未知" }, { value: "birth_date", label: "出生日期" },
    { value: "approximate", label: "約數年齡" },
];
export const profileAgeUnitOptions = [
    { value: "days", label: "日" }, { value: "weeks", label: "星期" },
    { value: "months", label: "個月" }, { value: "years", label: "歲" },
];
export const emptyProfileForm = () => ({
    ageKind: "unknown", birthDate: "", ageRaw: "", ageUnit: "months", ageAsOf: "",
    dueDate: "", gestationalWeeksRaw: "", region: "", language: "", allergies: "",
    specialNeeds: "", preferences: "", source: "", validUntil: "", reason: "",
});
export function profileFormFromData(data) {
    if (!data)
        return emptyProfileForm();
    return {
        ageKind: data.age.kind,
        birthDate: data.age.kind === "birth_date" ? data.age.date : "",
        ageRaw: data.age.kind === "approximate" ? data.age.rawValue : "",
        ageUnit: data.age.kind === "approximate" ? data.age.unit : "months",
        ageAsOf: data.age.kind === "approximate" ? data.age.asOf : "",
        dueDate: data.dueDate ?? "", gestationalWeeksRaw: data.gestationalWeeksRaw ?? "",
        region: data.region ?? "", language: data.language ?? "", allergies: data.allergies ?? "",
        specialNeeds: data.specialNeeds ?? "", preferences: data.preferences ?? "",
        source: data.source, validUntil: data.validUntil ?? "", reason: "",
    };
}
export function profileDataFromForm(values) {
    const optional = (value) => value === "" ? null : value;
    return {
        age: values.ageKind === "unknown" ? { kind: "unknown" }
            : values.ageKind === "birth_date" ? { kind: "birth_date", date: values.birthDate }
                : { kind: "approximate", rawValue: values.ageRaw, unit: values.ageUnit, asOf: values.ageAsOf },
        dueDate: optional(values.dueDate), gestationalWeeksRaw: optional(values.gestationalWeeksRaw),
        region: optional(values.region), language: optional(values.language), allergies: optional(values.allergies),
        specialNeeds: optional(values.specialNeeds), preferences: optional(values.preferences),
        source: values.source, validUntil: optional(values.validUntil),
    };
}
