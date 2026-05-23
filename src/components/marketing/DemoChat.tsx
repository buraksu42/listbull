/**
 * Static chat-bubble simulation that stands in for an animated
 * demo. Real chat copy from the bot: a quick capture + reminder, a
 * checklist umbrella, and a self-destruct password reveal — the
 * three most demo-worthy moments.
 */
export function DemoChat() {
  return (
    <div className="demo-block">
      <div className="container">
        <div className="chat" role="img" aria-label="Example chat with @listbull_bot">
          <div className="bubble-row from-user">
            <div className="bubble user">buy milk, remind me at 6pm</div>
            <span className="timestamp">17:42</span>
          </div>
          <div className="bubble-row from-bot">
            <div className="bubble bot">
              <span className="check">✓</span> added <code>buy milk</code>.{" "}
              <span aria-hidden>⏰</span> reminder set for 18:00.
            </div>
            <span className="timestamp">17:42</span>
          </div>
          <div className="bubble-row from-user">
            <div className="bubble user">
              weekly cleanup: laundry, dishes, trash
            </div>
            <span className="timestamp">17:43</span>
          </div>
          <div className="bubble-row from-bot">
            <div className="bubble bot">
              <span className="check">✓</span> created 1 parent + 3
              sub-items. <code>/items</code> now shows{" "}
              <span aria-hidden>📂</span> 0/3.
            </div>
            <span className="timestamp">17:43</span>
          </div>
          <div className="bubble-row from-user">
            <div className="bubble user">what&rsquo;s the gmail password?</div>
            <span className="timestamp">17:44</span>
          </div>
          <div className="bubble-row from-bot">
            <div className="bubble bot">
              <span className="lock">🔒</span> revealing <code>gmail</code>…
              username + password sent.
              <span className="destruct">self-destructs in 15s</span>
            </div>
            <span className="timestamp">17:44</span>
          </div>
        </div>
      </div>
    </div>
  );
}
