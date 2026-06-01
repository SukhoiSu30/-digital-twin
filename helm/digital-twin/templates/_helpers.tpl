{{/*
================================================================
HELPER TEMPLATES — Reusable template functions
================================================================
These are like utility functions in programming.
Instead of repeating the same labels everywhere, define once, use everywhere.

Usage: {{ include "digital-twin.labels" . }}
The "include" function calls the template and inserts the result.
================================================================
*/}}

{{/*
Chart name — used as a base for resource naming
*/}}
{{- define "digital-twin.name" -}}
{{ .Chart.Name }}
{{- end }}

{{/*
Common labels — applied to ALL resources for consistent identification
Every resource gets these labels so you can:
  kubectl get all -l app=digital-twin    (find everything)
  kubectl get all -l component=api       (find just API resources)
*/}}
{{- define "digital-twin.labels" -}}
app: {{ .Chart.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Selector labels — used by Deployments and Services to match pods
These must NOT change after creation (immutable in K8s)
*/}}
{{- define "digital-twin.selectorLabels" -}}
app: {{ .Chart.Name }}
{{- end }}
