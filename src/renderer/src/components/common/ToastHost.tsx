import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useToastStore } from '../../stores/appStore'

const icons = {
  success: <CheckCircle2 size={16} />,
  danger: <AlertCircle size={16} />,
  info: <Info size={16} />
}

export function ToastHost(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => dismiss(toast.id)}>
          {icons[toast.tone]}
          <span data-selectable>{toast.message}</span>
          {toast.action ? (
            <button
              className="toast__action"
              onClick={(e) => {
                e.stopPropagation()
                toast.action!.onClick()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
