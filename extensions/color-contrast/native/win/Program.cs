using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
  [STAThread]
  private static int Main(string[] args)
  {
    NativeMethods.TryEnablePerMonitorDpiAwareness();

    int timeoutMs = 60000;
    string? outPath = null;
    int? sampleFgX = null;
    int? sampleFgY = null;
    int? sampleBgX = null;
    int? sampleBgY = null;
    for (int i = 0; i < args.Length; i++)
    {
      if (args[i] == "--timeout-ms" && i + 1 < args.Length)
      {
        if (int.TryParse(args[i + 1], out int parsed))
        {
          timeoutMs = parsed;
        }
      }

      if (args[i] == "--out" && i + 1 < args.Length)
      {
        outPath = args[i + 1];
      }

      if (args[i] == "--sample-fg-x" && i + 1 < args.Length)
      {
        if (int.TryParse(args[i + 1], out int parsed))
        {
          sampleFgX = parsed;
        }
      }

      if (args[i] == "--sample-fg-y" && i + 1 < args.Length)
      {
        if (int.TryParse(args[i + 1], out int parsed))
        {
          sampleFgY = parsed;
        }
      }

      if (args[i] == "--sample-bg-x" && i + 1 < args.Length)
      {
        if (int.TryParse(args[i + 1], out int parsed))
        {
          sampleBgX = parsed;
        }
      }

      if (args[i] == "--sample-bg-y" && i + 1 < args.Length)
      {
        if (int.TryParse(args[i + 1], out int parsed))
        {
          sampleBgY = parsed;
        }
      }
    }

    if (sampleFgX.HasValue && sampleFgY.HasValue && sampleBgX.HasValue && sampleBgY.HasValue)
    {
      if (!NativeMethods.TryGetScreenPixelHex(sampleFgX.Value, sampleFgY.Value, out string fgHex))
      {
        fputs("Failed to read foreground pixel.\n");
        return 1;
      }

      if (!NativeMethods.TryGetScreenPixelHex(sampleBgX.Value, sampleBgY.Value, out string bgHex))
      {
        fputs("Failed to read background pixel.\n");
        return 1;
      }

      PickedPixel fg = new PickedPixel
      {
        X = sampleFgX.Value,
        Y = sampleFgY.Value,
        Hex = fgHex,
      };

      PickedPixel bg = new PickedPixel
      {
        X = sampleBgX.Value,
        Y = sampleBgY.Value,
        Hex = bgHex,
      };

      PickResult sampleResult = new PickResult
      {
        Foreground = fg,
        Background = bg,
      };

      string sampleJson = JsonSerializer.Serialize(sampleResult, new JsonSerializerOptions
      {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
      });

      if (!string.IsNullOrWhiteSpace(outPath))
      {
        try
        {
          File.WriteAllText(outPath, sampleJson);
        }
        catch
        {
          // Best effort: continue to stdout.
        }
      }

      try
      {
        Console.WriteLine(sampleJson);
      }
      catch
      {
        // Best effort: stdout may not be attached depending on how we are launched.
      }

      return 0;
    }

    ApplicationConfiguration.Initialize();

    using PickerApp app = new PickerApp(timeoutMs, outPath);
    PickResult? result = app.Run();

    if (result is null)
    {
      // app sets exit code details
      return app.ExitCode;
    }

    string json = JsonSerializer.Serialize(result, new JsonSerializerOptions
    {
      PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
      DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
      WriteIndented = false,
    });

    if (!string.IsNullOrWhiteSpace(outPath))
    {
      try
      {
        File.WriteAllText(outPath, json);
      }
      catch
      {
        // Best effort: continue to stdout.
      }
    }

    try
    {
      Console.WriteLine(json);
    }
    catch
    {
      // Best effort: stdout may not be attached depending on how we are launched.
    }
    return 0;
  }

  private static void fputs(string message)
  {
    try
    {
      Console.Error.Write(message);
      Console.Error.Flush();
    }
    catch
    {
      // best effort
    }
  }
}

internal sealed class PickerApp : IDisposable
{
  private readonly int _timeoutMs;
  private readonly string? _outPath;
  private readonly Stopwatch _stopwatch = Stopwatch.StartNew();
  private readonly ManualResetEventSlim _done = new(false);
  private readonly SynchronizationContext _uiSyncContext;
  private IntPtr _mouseHook = IntPtr.Zero;
  private IntPtr _keyboardHook = IntPtr.Zero;
  private readonly NativeMethods.LowLevelMouseProc _mouseProc;
  private readonly NativeMethods.LowLevelKeyboardProc _keyboardProc;

  private volatile bool _canceled;
  private volatile bool _timedOut;
  private volatile bool _failed;

  private int _pickedDownCount;

  private PickedPixel? _foreground;
  private PickedPixel? _background;

  private MagnifierForm? _form;

  public int ExitCode
  {
    get;
    private set;
  }

  public PickerApp(int timeoutMs, string? outPath)
  {
    _timeoutMs = timeoutMs;
    _outPath = outPath;
    ExitCode = 1;

    _uiSyncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

    _mouseProc = MouseHookCallback;
    _keyboardProc = KeyboardHookCallback;
  }

  public PickResult? Run()
  {
    using System.Threading.Timer timeoutTimer = new System.Threading.Timer(_ =>
    {
      if (_done.IsSet)
      {
        return;
      }

      if (_stopwatch.ElapsedMilliseconds >= _timeoutMs)
      {
        _timedOut = true;
        ExitCode = 4;
        RequestExit();
      }
    }, null, 100, 100);

    _form = new MagnifierForm(
    () => _pickedDownCount,
    () => GetCurrentHoverHex()
    );

    InstallHooks();
    if (_mouseHook == IntPtr.Zero || _keyboardHook == IntPtr.Zero)
    {
      ExitCode = 3;
      UninstallHooks();
      _form.Dispose();
      return null;
    }

    Application.Run(_form);
    _done.Set();
    UninstallHooks();

    if (_canceled)
    {
      ExitCode = 2;
      return null;
    }

    if (_timedOut)
    {
      ExitCode = 4;
      return null;
    }

    if (_failed)
    {
      return null;
    }

    if (_foreground is null || _background is null)
    {
      ExitCode = 5;
      return null;
    }

    ExitCode = 0;
    return new PickResult
    {
      Foreground = _foreground,
      Background = _background,
    };
  }

  public void Dispose()
  {
    UninstallHooks();
    _done.Dispose();
  }

  private void InstallHooks()
  {
    IntPtr hMod = NativeMethods.GetModuleHandle(null);
    _mouseHook = NativeMethods.SetWindowsHookEx(NativeMethods.WH_MOUSE_LL, _mouseProc, hMod, 0);
    _keyboardHook = NativeMethods.SetWindowsHookEx(NativeMethods.WH_KEYBOARD_LL, _keyboardProc, hMod, 0);
  }

  private void UninstallHooks()
  {
    if (_mouseHook != IntPtr.Zero)
    {
      NativeMethods.UnhookWindowsHookEx(_mouseHook);
      _mouseHook = IntPtr.Zero;
    }

    if (_keyboardHook != IntPtr.Zero)
    {
      NativeMethods.UnhookWindowsHookEx(_keyboardHook);
      _keyboardHook = IntPtr.Zero;
    }
  }

  private string GetCurrentHoverHex()
  {
    Point p = Cursor.Position;
    if (NativeMethods.TryGetScreenPixelHex(p.X, p.Y, out string hex))
    {
      return hex;
    }

    return "#000000";
  }

  private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
  {
    if (nCode >= 0 && !_canceled && !_timedOut && _pickedDownCount < 2)
    {
      if (wParam == (IntPtr)NativeMethods.WM_LBUTTONDOWN || wParam == (IntPtr)NativeMethods.WM_LBUTTONUP)
      {
        if (wParam == (IntPtr)NativeMethods.WM_LBUTTONDOWN)
        {
          NativeMethods.MSLLHOOKSTRUCT hookStruct = Marshal.PtrToStructure<NativeMethods.MSLLHOOKSTRUCT>(lParam);
          int x = hookStruct.pt.x;
          int y = hookStruct.pt.y;
          if (!NativeMethods.TryGetScreenPixelHex(x, y, out string hex))
          {
            ExitCode = 1;
            _failed = true;
            RequestExit();
            return (IntPtr)1;
          }

          PickedPixel picked = new PickedPixel
          {
            X = x,
            Y = y,
            Hex = hex,
          };

          if (_pickedDownCount == 0)
          {
            _foreground = picked;
          }
          else
          {
            _background = picked;
          }

          _pickedDownCount++;
          EmitProgress();

          if (_pickedDownCount >= 2)
          {
            RequestExit();
          }
        }

        // Swallow the click (down + up) for the first two picks.
        return (IntPtr)1;
      }
    }

    return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }

  private void EmitProgress()
  {
    PickProgress progress = new PickProgress
    {
      Foreground = _foreground,
      Background = _background,
    };

    string json = JsonSerializer.Serialize(progress, new JsonSerializerOptions
    {
      PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
      DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
      WriteIndented = false,
    });

    if (!string.IsNullOrWhiteSpace(_outPath))
    {
      try
      {
        File.WriteAllText(_outPath, json);
      }
      catch
      {
        // best effort
      }
    }

    try
    {
      Console.WriteLine(json);
      Console.Out.Flush();
    }
    catch
    {
      // best effort
    }
  }

  private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
  {
    if (nCode >= 0 && wParam == (IntPtr)NativeMethods.WM_KEYDOWN)
    {
      NativeMethods.KBDLLHOOKSTRUCT hookStruct = Marshal.PtrToStructure<NativeMethods.KBDLLHOOKSTRUCT>(lParam);
      if (hookStruct.vkCode == NativeMethods.VK_ESCAPE)
      {
        _canceled = true;
        ExitCode = 2;
        RequestExit();
      }
    }

    return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }

  private void RequestExit()
  {
    _uiSyncContext.Post(_ =>
    {
      if (_form is not null && !_form.IsDisposed)
      {
        _form.Close();
      }
      else
      {
        Application.ExitThread();
      }
    }, null);
  }
}

internal sealed class MagnifierForm : Form
{
  private const int Zoom = 12;
  private const int SampleSize = 17;
  private const int PaddingPx = 10;

  private readonly Func<int> _getPickedCount;
  private readonly Func<string> _getHoverHex;
  private readonly System.Windows.Forms.Timer _timer;

  public MagnifierForm(Func<int> getPickedCount, Func<string> getHoverHex)
  {
    _getPickedCount = getPickedCount;
    _getHoverHex = getHoverHex;

    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    DoubleBuffered = true;

    Width = (SampleSize * Zoom) + (PaddingPx * 2);
    Height = Width + 40;

    _timer = new System.Windows.Forms.Timer
    {
      Interval = 16,
    };
    _timer.Tick += (_, _) =>
    {
      RepositionNearCursor();
      Invalidate();
    };
    _timer.Start();
  }

  protected override bool ShowWithoutActivation => true;

  protected override CreateParams CreateParams
  {
    get
    {
      const int WS_EX_TOOLWINDOW = 0x00000080;
      const int WS_EX_NOACTIVATE = 0x08000000;
      const int WS_EX_TRANSPARENT = 0x00000020;

      CreateParams cp = base.CreateParams;
      cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
      return cp;
    }
  }

  protected override void OnPaint(PaintEventArgs e)
  {
    base.OnPaint(e);

    e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
    e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
    e.Graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;

    Rectangle canvas = new Rectangle(0, 0, Width, Height);
    using SolidBrush bg = new SolidBrush(Color.FromArgb(255, 20, 20, 20));
    e.Graphics.FillRectangle(bg, canvas);

    Rectangle magnifierRect = new Rectangle(PaddingPx, PaddingPx, SampleSize * Zoom, SampleSize * Zoom);
    using Bitmap bmp = CaptureMagnifiedBitmap();
    e.Graphics.DrawImage(bmp, magnifierRect);

    using Pen border = new Pen(Color.FromArgb(230, 255, 255, 255), 2);
    e.Graphics.DrawRectangle(border, magnifierRect);

    DrawCrosshairAndGrid(e.Graphics, magnifierRect);
    DrawText(e.Graphics);
  }

  protected override void OnFormClosed(FormClosedEventArgs e)
  {
    _timer.Stop();
    _timer.Dispose();
    base.OnFormClosed(e);
  }

  private void RepositionNearCursor()
  {
    Point p = Cursor.Position;
    Rectangle screen = Screen.FromPoint(p).WorkingArea;

    int x = p.X + 24;
    int y = p.Y + 24;

    if (x + Width > screen.Right)
    {
      x = p.X - Width - 24;
    }

    if (y + Height > screen.Bottom)
    {
      y = p.Y - Height - 24;
    }

    Location = new Point(
      Math.Clamp(x, screen.Left, screen.Right - Width),
      Math.Clamp(y, screen.Top, screen.Bottom - Height)
      );
  }

  private Bitmap CaptureMagnifiedBitmap()
  {
    Point cursor = Cursor.Position;
    int half = SampleSize / 2;

    Rectangle src = new Rectangle(cursor.X - half, cursor.Y - half, SampleSize, SampleSize);
    Bitmap small = new Bitmap(SampleSize, SampleSize);
    using (Graphics g = Graphics.FromImage(small))
    {
      g.CopyFromScreen(src.Location, Point.Empty, src.Size);
    }

    Bitmap large = new Bitmap(SampleSize * Zoom, SampleSize * Zoom);
    using (Graphics g = Graphics.FromImage(large))
    {
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
      g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
      g.DrawImage(small, new Rectangle(0, 0, large.Width, large.Height));
    }

    small.Dispose();
    return large;
  }

  private void DrawCrosshairAndGrid(Graphics g, Rectangle rect)
  {
    using Pen gridPen = new Pen(Color.FromArgb(60, 255, 255, 255), 1);
    for (int i = 1; i < SampleSize; i++)
    {
      int x = rect.Left + (i * Zoom);
      int y = rect.Top + (i * Zoom);
      g.DrawLine(gridPen, x, rect.Top, x, rect.Bottom);
      g.DrawLine(gridPen, rect.Left, y, rect.Right, y);
    }

    int centerIndex = SampleSize / 2;
    int cx = rect.Left + (centerIndex * Zoom);
    int cy = rect.Top + (centerIndex * Zoom);

    using Pen cross = new Pen(Color.FromArgb(230, 255, 80, 80), 2);
    g.DrawRectangle(cross, new Rectangle(cx, cy, Zoom, Zoom));
  }

  private void DrawText(Graphics g)
  {
    string hoverHex = _getHoverHex();
    string text = hoverHex;

    using Font font = new Font("Segoe UI", 10, FontStyle.Regular, GraphicsUnit.Point);
    using SolidBrush brush = new SolidBrush(Color.White);

    int swatchSize = 16;
    int swatchY = Height - 30;
    Rectangle swatchRect = new Rectangle(PaddingPx, swatchY, swatchSize, swatchSize);
    DrawSwatch(g, swatchRect, hoverHex);

    float textX = PaddingPx + swatchSize + 8;
    g.DrawString(text, font, brush, new PointF(textX, Height - 28));
  }

  private static void DrawSwatch(Graphics g, Rectangle rect, string hex)
  {
    Color swatchColor = ParseHexColor(hex);

    using SolidBrush fill = new SolidBrush(swatchColor);
    g.FillRectangle(fill, rect);

    using Pen border = new Pen(Color.FromArgb(160, 255, 255, 255), 1);
    g.DrawRectangle(border, rect);
  }

  private static Color ParseHexColor(string hex)
  {
    try
    {
      return ColorTranslator.FromHtml(hex);
    }
    catch
    {
      return Color.Magenta;
    }
  }
}

internal static class NativeMethods
{
  public const int WH_MOUSE_LL = 14;
  public const int WH_KEYBOARD_LL = 13;

  public const int WM_LBUTTONDOWN = 0x0201;
  public const int WM_LBUTTONUP = 0x0202;
  public const int WM_KEYDOWN = 0x0100;

  public const int VK_ESCAPE = 0x1B;

  public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
  public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT
  {
    public int x;
    public int y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSLLHOOKSTRUCT
  {
    public POINT pt;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KBDLLHOOKSTRUCT
  {
    public int vkCode;
    public int scanCode;
    public int flags;
    public int time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr GetModuleHandle(string? lpModuleName);

  [DllImport("user32.dll")]
  private static extern IntPtr GetDC(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

  [DllImport("gdi32.dll")]
  private static extern uint GetPixel(IntPtr hdc, int nXPos, int nYPos);

  public static uint GetScreenPixelColorRef(int x, int y)
  {
    IntPtr hdc = GetDC(IntPtr.Zero);
    if (hdc == IntPtr.Zero)
    {
      return 0;
    }

    try
    {
      return GetPixel(hdc, x, y);
    }
    finally
    {
      ReleaseDC(IntPtr.Zero, hdc);
    }
  }

  public static string ColorRefToHex(uint colorRef)
  {
    uint r = colorRef & 0xFF;
    uint g = (colorRef >> 8) & 0xFF;
    uint b = (colorRef >> 16) & 0xFF;
    return $"#{r:X2}{g:X2}{b:X2}";
  }

  [DllImport("user32.dll")]
  private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

  private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

  public static void TryEnablePerMonitorDpiAwareness()
  {
    try
    {
      SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    catch
    {
      // best effort
    }
  }

  public static bool TryGetScreenPixelHex(int x, int y, out string hex)
  {
    hex = "#000000";

    try
    {
      using Bitmap bmp = new Bitmap(1, 1);
      using Graphics g = Graphics.FromImage(bmp);
      g.CopyFromScreen(x, y, 0, 0, new Size(1, 1));
      Color c = bmp.GetPixel(0, 0);
      hex = $"#{c.R:X2}{c.G:X2}{c.B:X2}";
      return true;
    }
    catch
    {
      return false;
    }
  }
}

internal sealed class PickResult
{
  public required PickedPixel Foreground
  {
    get;
    init;
  }

  public required PickedPixel Background
  {
    get;
    init;
  }
}

internal sealed class PickProgress
{
  public PickedPixel? Foreground
  {
    get;
    init;
  }

  public PickedPixel? Background
  {
    get;
    init;
  }
}

internal sealed class PickedPixel
{
  public required int X
  {
    get;
    init;
  }

  public required int Y
  {
    get;
    init;
  }

  public required string Hex
  {
    get;
    init;
  }
}
