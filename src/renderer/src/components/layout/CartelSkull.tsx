import ytCartelLogo from '../../assets/yt-cartel-logo.png'

/**
 * Логотип YT CARTEL (2.1.2): PNG без фону з надписом.
 * Зберігає glow-підсветку і легке погойдування старого SVG-скелета.
 */
export function CartelSkull(props: { size?: number }): React.JSX.Element {
  const size = props.size ?? 96
  const height = Math.round(size * (340 / 360)) // пропорції вихідного PNG
  return (
    <div className="skull-wrap">
      <div className="skull-glow" />
      <img
        className="skull-svg"
        src={ytCartelLogo}
        alt="YT Cartel"
        width={size}
        height={height}
        draggable={false}
      />
    </div>
  )
}
