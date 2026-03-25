# HƯỚNG DẪN TÍCH HỢP
## Facebook Login (SSO) + Messenger API cho Next.js App - Mở từ Messenger

> **Phiên bản:** 1.0 | **Stack:** Next.js 14 (App Router) | **FB API:** v19.0

---

## Tổng quan tính năng

| Tính năng | Phương pháp | Trạng thái |
|---|---|---|
| Facebook Login (SSO) | FB JS SDK + `getLoginStatus()` | Sẵn sàng |
| Tự động login trong IAB | `fbAsyncInit` khi app load | Sẵn sàng |
| Gửi tin nhắn qua API | Graph API `/me/messages` | Cần Page Token |
| Phát hiện môi trường IAB | UserAgent detect | Sẵn sàng |

---

## Phần 1: Tổng quan hệ thống

### 1.1 Bối cảnh và mục tiêu

Web Next.js được chia sẻ qua Messenger. Khi user bấm link, web mở trong **In-App Browser (IAB)** của Facebook — không phải Chrome hay Safari. Điều này tạo ra những thách thức đặc biệt cho việc xác thực người dùng.

**Mục tiêu cần đạt:**
- User mở link từ Messenger → vào web mà không cần nhập mật khẩu
- Lần đầu tiên: chỉ cần bấm 1 nút cho phép ("Tiếp tục với Facebook")
- Lần sau: tự động login, vào thẳng luôn không hỏi thêm gì
- Web có thể gửi tin nhắn vào nhóm/inbox qua Messenger API

### 1.2 Tại sao IAB khác browser thường

| Đặc điểm | Browser thường | Facebook IAB |
|---|---|---|
| OAuth popup | Hoạt động bình thường | Bị chặn, không hoạt động |
| Session FB | Riêng biệt với app FB | Chia sẻ với app Messenger |
| FB JS SDK | Dùng popup/redirect | Dùng native FB session |
| Trải nghiệm login | Redirect sang trang FB | Dialog nhỏ, 1 tap |

> ✅ **OK:** IAB của Facebook CHIA SẺ session với app Messenger. Người dùng đã đăng nhập FB trên điện thoại → SDK có thể lấy token mà không cần nhập lại mật khẩu.

### 1.3 Flow tổng thể

1. **User bấm link trong Messenger** → web mở trong IAB
2. **FB JS SDK tự động chạy** → gọi `getLoginStatus()`
3. **Đã approve trước?** → nhận token ngay, không hỏi gì thêm
4. **Chưa approve?** → hiện dialog "Tiếp tục với Facebook" (1 tap)
5. **Web nhận access_token** → user đã login, vào thẳng nội dung

---

## Phần 2: Cài đặt Facebook App

### 2.1 Tạo Facebook App

1. Đăng nhập vào [developers.facebook.com](https://developers.facebook.com)
2. Bấm **"Create App"** → chọn loại **"Consumer"** hoặc **"Business"**
3. Điền App Name, email liên hệ
4. Vào **"Add Products"** → tìm và thêm **"Facebook Login"** và **"Messenger"**

> ⚠️ **LƯU Ý:** Ghi lại **App ID** và **App Secret**. Sẽ cần dùng cho cả frontend (App ID) và backend (App Secret).

### 2.2 Cấu hình Facebook Login

Vào **Settings > Basic** của Facebook Login:

- **Valid OAuth Redirect URIs:** thêm `https://yourdomain.com/`
- **Allowed Domains:** thêm `yourdomain.com`
- **Client OAuth Login:** ON
- **Web OAuth Login:** ON
- **Enforce HTTPS:** ON

> ℹ️ **INFO:** Trong quá trình phát triển có thể dùng `http://localhost:3000`. Khi lên production phải đổi sang HTTPS.

### 2.3 Lấy Page Access Token cho Messenger API

Để gửi tin nhắn qua Messenger API, cần một Facebook Page làm "người gửi":

1. Tạo hoặc dùng một Facebook Page có sẵn
2. Vào **Facebook App > Messenger > Settings**
3. Ở mục **"Access Tokens"** → chọn Page → **Generate Token**
4. Copy token này (sẽ hết hạn sau 60 ngày, cần refresh định kỳ hoặc dùng long-lived token)

> ℹ️ **INFO:** Page Access Token chỉ cần cho chức năng gửi tin nhắn. Việc login SSO không cần token này.

### 2.4 Biến môi trường (.env.local)

```env
# Facebook App
NEXT_PUBLIC_FB_APP_ID=123456789

# Chỉ dùng ở server-side, không expose ra frontend
FB_APP_SECRET=abc123...
FB_PAGE_ACCESS_TOKEN=EAAxxxxxx...

# NextAuth (nếu dùng)
NEXTAUTH_SECRET=random-secret-string
NEXTAUTH_URL=https://yourdomain.com
```

> 🚨 **QUAN TRỌNG:** `NEXT_PUBLIC_` prefix mới được expose ra browser. `FB_APP_SECRET` và `FB_PAGE_ACCESS_TOKEN` TUYỆT ĐỐI không được có `NEXT_PUBLIC_`.

---

## Phần 3: Implementation - Facebook Login (SSO)

### 3.1 Load FB JS SDK

Thêm SDK vào layout chính để nó load trên mọi trang:

```tsx
// app/layout.tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  )
}
```

### 3.2 Khởi tạo SDK và tự động login

Đây là file quan trọng nhất. SDK sẽ tự động kiểm tra session khi app load:

```typescript
// lib/facebook-sdk.ts
declare global {
  interface Window { FB: any; fbAsyncInit: () => void }
}

export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve) => {
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: process.env.NEXT_PUBLIC_FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v19.0',
      })
      resolve()
    }
  })
}

// Kiểm tra xem user đã login chưa (không hiện popup, không redirect)
export function checkLoginStatus(): Promise<any> {
  return new Promise((resolve) => {
    window.FB.getLoginStatus((response: any) => {
      resolve(response)
    })
  })
}

// Gọi login - lần đầu: hiện dialog 1 tap; lần sau: tự động trả token
export function loginWithFacebook(): Promise<any> {
  return new Promise((resolve, reject) => {
    window.FB.login((response: any) => {
      if (response.authResponse) {
        resolve(response.authResponse)
      } else {
        reject(new Error('User cancelled login'))
      }
    }, { scope: 'public_profile,email' })
  })
}

// Detect môi trường IAB của Facebook
export function isInFacebookBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return ua.includes('FBAN') || ua.includes('FBAV') || ua.includes('FB_IAB')
}
```

### 3.3 AuthProvider - Xử lý trạng thái login

Tạo Context để quản lý trạng thái auth toàn cục trong app:

```tsx
// contexts/AuthContext.tsx
'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { initFacebookSDK, checkLoginStatus, loginWithFacebook } from '@/lib/facebook-sdk'

const AuthContext = createContext<any>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Khởi tạo SDK và tự động kiểm tra session
    initFacebookSDK().then(async () => {
      const response = await checkLoginStatus()
      if (response.status === 'connected') {
        // Đã có session → lấy thông tin user, không hỏi gì
        const userInfo = await getUserInfo(response.authResponse.accessToken)
        setUser(userInfo)
      }
      setLoading(false)
    })
  }, [])

  const login = async () => {
    const auth = await loginWithFacebook()
    const userInfo = await getUserInfo(auth.accessToken)
    setUser(userInfo)
    return userInfo
  }

  const logout = () => {
    window.FB.logout(() => setUser(null))
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// Lấy thông tin user từ Graph API
async function getUserInfo(accessToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
  )
  return res.json()
}
```

### 3.4 Component LoginButton

```tsx
// components/LoginButton.tsx
'use client'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginButton() {
  const { user, loading, login, logout } = useAuth()

  if (loading) return <div>Đang kiểm tra đăng nhập...</div>

  if (user) {
    return (
      <div>
        <img src={user.picture?.data?.url} alt={user.name} />
        <span>Xin chào, {user.name}</span>
        <button onClick={logout}>Đăng xuất</button>
      </div>
    )
  }

  return (
    <button onClick={login}>
      Đăng nhập với Facebook
    </button>
  )
}
```

### 3.5 Wrap app với AuthProvider

```tsx
// app/layout.tsx - thêm AuthProvider
import { AuthProvider } from '@/contexts/AuthContext'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

---

## Phần 4: Implementation - Messenger API

### 4.1 Các loại tin nhắn có thể gửi

| Loại | Điều kiện | Use case |
|---|---|---|
| Inbox Facebook Page | Có Page Access Token | Thông báo từ hệ thống |
| Chat 1-1 với user | User nhắn tin cho Page trước | Hỗ trợ, xác nhận đơn hàng |
| Nhóm Messenger | Group API (beta), cần review | Thông báo nhóm nội bộ |

> ⚠️ **LƯU Ý:** Để gửi tin nhắn cho user lần đầu, user phải nhắn tin cho Page trước (24h window rule của Facebook). Sau đó có thể gửi trong 24h. Muốn gửi bất cứ lúc nào cần đăng ký **Message Tags**.

### 4.2 API Route gửi tin nhắn

```typescript
// app/api/send-message/route.ts
import { NextRequest, NextResponse } from 'next/server'

const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN

export async function POST(req: NextRequest) {
  const { recipientId, message, messageType = 'text' } = await req.json()

  // Kiểm tra authentication (bổ sung middleware của bạn)
  // const session = await getSession(req)
  // if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = {
    recipient: { id: recipientId },
    message: messageType === 'text'
      ? { text: message }
      : message, // Truyền object phức tạp cho template/attachment
    messaging_type: 'MESSAGE_TAG',
    tag: 'ACCOUNT_UPDATE', // Hoặc CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE
  }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  const data = await res.json()

  if (data.error) {
    console.error('FB API Error:', data.error)
    return NextResponse.json({ error: data.error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, messageId: data.message_id })
}
```

### 4.3 Gửi tin nhắn template (có nút bấm)

```typescript
// Gửi tin nhắn kiểu template với nút bấm
const templateMessage = {
  attachment: {
    type: 'template',
    payload: {
      template_type: 'button',
      text: 'Bạn có đơn hàng mới! Kiểm tra ngay.',
      buttons: [
        {
          type: 'web_url',
          url: 'https://yourdomain.com/orders',
          title: 'Xem đơn hàng',
          webview_height_ratio: 'full',
        },
        {
          type: 'postback',
          title: 'Hủy đơn',
          payload: 'CANCEL_ORDER_123',
        }
      ]
    }
  }
}

// Gọi API
await fetch('/api/send-message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    recipientId: user.facebookId,
    message: templateMessage,
    messageType: 'template'
  })
})
```

### 4.4 Lấy PSID (Page-Scoped User ID) của user

PSID là ID duy nhất của user đối với Page của bạn — dùng để gửi tin nhắn. Lấy bằng cách gọi Graph API với token của user sau khi login:

```typescript
// Lấy PSID sau khi user login thành công
async function getUserPSID(userAccessToken: string): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/me/ids_for_pages` +
    `?page_id=${process.env.NEXT_PUBLIC_FB_PAGE_ID}` +
    `&access_token=${userAccessToken}`
  )
  const data = await res.json()
  // data.data[0].id là PSID
  return data.data?.[0]?.id
}

// Lưu PSID vào database cùng với thông tin user
// để sau này có thể gửi tin nhắn không cần user online
```

---

## Phần 5: Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `FB.login()` không làm gì | Popup bị chặn trong IAB | Dùng FB JS SDK, không dùng `window.open()` |
| `status: 'unknown'` | SDK chưa load xong | Đợi `fbAsyncInit` callback |
| Error 190: Invalid token | Token hết hạn | Gọi `FB.getLoginStatus()` lại để refresh |
| Error 10: Permission denied | Thiếu scope | Thêm scope vào `FB.login()` |
| Error 100: No recipient | PSID sai hoặc chưa có | Kiểm tra user đã nhắn tin cho Page chưa |
| Lỗi CORS trên localhost | FB API không chấp nhận localhost | Thêm localhost vào App Domains trong FB Dev |

### 5.1 Xử lý token hết hạn

```typescript
// Wrapper tự động refresh token khi cần
async function callWithFreshToken(apiCall: (token: string) => Promise<any>) {
  const status = await checkLoginStatus()

  if (status.status !== 'connected') {
    // Token hết hạn hoặc chưa login → gọi login lại
    const auth = await loginWithFacebook()
    return apiCall(auth.accessToken)
  }

  return apiCall(status.authResponse.accessToken)
}
```

### 5.2 Xử lý trường hợp user mở từ browser thường

App phải hoạt động tốt cả trong IAB lẫn browser thường. Detect môi trường để chọn flow phù hợp:

```typescript
// hooks/useSmartLogin.ts
import { isInFacebookBrowser } from '@/lib/facebook-sdk'

export function useSmartLogin() {
  const { login } = useAuth()
  const isIAB = isInFacebookBrowser()

  const handleLogin = async () => {
    if (isIAB) {
      // Trong IAB: FB SDK sẽ xử lý ngầm, rất ít khi cần popup
      return login()
    } else {
      // Trong browser thường: FB SDK dùng redirect flow
      // Hoặc dùng NextAuth: signIn('facebook')
      return login()
    }
  }

  return { handleLogin, isIAB }
}
```

---

## Phần 6: Checklist triển khai

### Setup Facebook App
- [ ] Tạo Facebook App trên developers.facebook.com
- [ ] Thêm sản phẩm Facebook Login và Messenger
- [ ] Thêm domain và redirect URI vào cài đặt
- [ ] Lấy App ID và Page Access Token
- [ ] Điền biến môi trường vào `.env.local`

### Code (theo thứ tự này)
- [ ] Cài SDK Script vào `app/layout.tsx`
- [ ] Tạo `lib/facebook-sdk.ts`
- [ ] Tạo `contexts/AuthContext.tsx`
- [ ] Wrap `<AuthProvider>` vào layout
- [ ] Thêm `<LoginButton />` vào trang cần thiết
- [ ] Tạo `app/api/send-message/route.ts`
- [ ] Test flow login trên điện thoại thực tế (mở link qua Messenger)

### Kiểm tra trước khi lên production
- [ ] Test trên iOS và Android
- [ ] Test cả hai trường hợp: có session sẵn và chưa login
- [ ] Đổi HTTPS (FB không cho phép HTTP trên production)
- [ ] Submit App Review nếu cần quyền gửi tin nhắn ngoài 24h
- [ ] Set up long-lived Page Access Token (không hết hạn sau 60 ngày)

> ⚠️ **LƯU Ý:** Trong chế độ development, chỉ có Test Users hoặc Admin/Developer của app mới login được. Phải submit review để mở ra cho tất cả mọi người.

---

## Phần 7: Cấu trúc thư mục

```
your-nextjs-app/
├── app/
│   ├── layout.tsx              ← Load FB SDK + AuthProvider
│   ├── page.tsx
│   └── api/
│       └── send-message/
│           └── route.ts        ← Messenger API endpoint
├── contexts/
│   └── AuthContext.tsx         ← Auth state + auto-login logic
├── lib/
│   └── facebook-sdk.ts         ← SDK helpers: init, login, detect IAB
├── components/
│   └── LoginButton.tsx         ← UI component
├── hooks/
│   └── useSmartLogin.ts        ← IAB-aware login hook (optional)
└── .env.local                  ← NEXT_PUBLIC_FB_APP_ID, FB_PAGE_ACCESS_TOKEN
```

---

*Tài liệu này được tạo để hướng dẫn AI vibe code. Phiên bản API: Facebook Graph API v19.0 | Next.js 14 App Router*
