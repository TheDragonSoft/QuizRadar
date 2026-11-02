package com.quizradar.app.ui.components

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.math.BigDecimal

/**
 * Guards the QuizRadar mark against drifting away from the desktop one.
 *
 * The phone used to ship a different, monochrome radar than the desktop, so
 * the same product wore two different faces. The mark is now the v4 radar
 * squircle in both places: a [Canvas] drawing inside the app and the
 * adaptive launcher icon.
 *
 * Two things can silently break that promise:
 *
 *  - somebody edits the in-app drawing but forgets the launcher vector;
 *  - somebody edits one of them and the two stop being the same picture.
 *
 * So this test pins the launcher's VectorDrawable to the very geometry the
 * in-app drawing uses ([RadarMarkGeometry]) and to the v4 palette. If the
 * desktop mark changes, the numbers here change with it, deliberately.
 */
class RadarMarkTest {
    private val resDir =
        File(System.getProperty("user.dir") ?: ".").let { root ->
            listOf(
                File(root, "src/main/res"),
                File(root, "app/src/main/res"),
            ).firstOrNull { it.exists() } ?: File(root, "src/main/res")
        }

    private val foreground = File(resDir, "drawable/ic_launcher_foreground.xml")
    private val background = File(resDir, "drawable/ic_launcher_background.xml")
    private val adaptive = File(resDir, "mipmap-anydpi-v26/ic_launcher.xml")

    @Test
    fun `the launcher foreground draws the desktop radar artwork`() {
        assertTrue("the launcher foreground must exist", foreground.exists())
        val xml = foreground.readText()
        val geo = RadarMarkGeometry

        val centerX = n(geo.launcher(geo.CENTER_X))
        val centerY = n(geo.launcher(geo.CENTER_Y))

        // The three radar rings.
        listOf(
            geo.RING_RADII[0] to geo.RING_STROKE_WIDTHS[0],
            geo.RING_RADII[1] to geo.RING_STROKE_WIDTHS[1],
            geo.RING_RADII[2] to geo.RING_STROKE_WIDTHS[2],
        ).forEach { (radius, stroke) ->
            assertTrue(
                "the launcher must draw the ring of radius $radius",
                xml.contains(circle(centerX, centerY, geo.launcherSize(radius))),
            )
            assertTrue(
                "the launcher must stroke the ring of radius $radius with $stroke",
                xml.contains(attr("android:strokeWidth", n(geo.launcherSize(stroke)))),
            )
        }

        // The sweep sector.
        assertTrue(
            "the launcher must draw the sweep sector",
            xml.contains(
                "M$centerX,$centerY L${n(geo.launcher(geo.SWEEP_TOP_X))},${n(geo.launcher(geo.SWEEP_TOP_Y))} " +
                    "A${n(geo.launcherSize(geo.RING_RADII[0]))},${n(geo.launcherSize(geo.RING_RADII[0]))} 0 0 1 " +
                    "${n(geo.launcher(geo.SWEEP_END_X))},${n(geo.launcher(geo.SWEEP_END_Y))} Z",
            ),
        )

        // The gold needle.
        assertTrue(
            "the launcher must draw the gold needle",
            xml.contains(
                "M$centerX,$centerY L${n(geo.launcher(geo.NEEDLE_END_X))},${n(geo.launcher(geo.NEEDLE_END_Y))}",
            ),
        )
        assertTrue(
            "the launcher must stroke the needle with the desktop weight",
            xml.contains(attr("android:strokeWidth", n(geo.launcherSize(geo.NEEDLE_WIDTH)))),
        )

        // The hub.
        listOf(geo.HUB_RADIUS, geo.HUB_CORE_RADIUS).forEach { radius ->
            assertTrue(
                "the launcher must draw the hub of radius $radius",
                xml.contains(circle(centerX, centerY, geo.launcherSize(radius))),
            )
        }

        // The three exam blips.
        listOf(
            Triple(geo.GOLD_BLIP_X, geo.GOLD_BLIP_Y, geo.GOLD_BLIP_RADIUS),
            Triple(geo.GREEN_BLIP_X, geo.GREEN_BLIP_Y, geo.BLIP_RADIUS),
            Triple(geo.RED_BLIP_X, geo.RED_BLIP_Y, geo.BLIP_RADIUS),
        ).forEach { (x, y, radius) ->
            assertTrue(
                "the launcher must draw the blip at ($x, $y)",
                xml.contains(circle(n(geo.launcher(x)), n(geo.launcher(y)), geo.launcherSize(radius))),
            )
        }

        // The gold blip's pulse ring.
        assertTrue(
            "the launcher must draw the gold blip's pulse ring",
            xml.contains(
                circle(
                    n(geo.launcher(geo.GOLD_BLIP_X)),
                    n(geo.launcher(geo.GOLD_BLIP_Y)),
                    geo.launcherSize(geo.GOLD_RING_RADIUS),
                ),
            ),
        )
        assertTrue(
            "the launcher must stroke the gold blip's pulse ring",
            xml.contains(attr("android:strokeWidth", n(geo.launcherSize(geo.GOLD_RING_WIDTH)))),
        )

        // The two binder tabs, as capsules (a VectorDrawable has no <rect rx>).
        geo.TAB_X.forEach { tabX ->
            assertTrue(
                "the launcher must draw the binder tab at x=$tabX",
                xml.contains(capsule(tabX)),
            )
            // The capsule's rounded top must sit exactly on the tab's top edge.
            assertEquals(
                "the binder tab at x=$tabX must sit on the squircle's top edge",
                n(geo.launcher(geo.TAB_Y)),
                n(geo.launcher(geo.TAB_Y + geo.TAB_RADIUS) - geo.launcherSize(geo.TAB_RADIUS)),
            )
        }
    }

    @Test
    fun `the themed icon carries the same radar structure`() {
        val mono = File(resDir, "drawable/ic_launcher_monochrome.xml")
        assertTrue("the monochrome layer must exist", mono.exists())
        val xml = mono.readText()
        val geo = RadarMarkGeometry

        val centerX = n(geo.launcher(geo.CENTER_X))
        val centerY = n(geo.launcher(geo.CENTER_Y))

        geo.RING_RADII.forEach { radius ->
            assertTrue(
                "the themed icon must draw the ring of radius $radius",
                xml.contains(circle(centerX, centerY, geo.launcherSize(radius))),
            )
        }
        assertTrue(
            "the themed icon must draw the needle",
            xml.contains(
                "M$centerX,$centerY L${n(geo.launcher(geo.NEEDLE_END_X))},${n(geo.launcher(geo.NEEDLE_END_Y))}",
            ),
        )
        assertTrue(
            "the themed icon must draw the hub",
            xml.contains(circle(centerX, centerY, geo.launcherSize(geo.HUB_RADIUS))),
        )
        geo.TAB_X.forEach { tabX ->
            assertTrue(
                "the themed icon must draw the binder tab at x=$tabX",
                xml.contains(capsule(tabX)),
            )
        }
    }

    @Test
    fun `the launcher foreground carries the desktop colours`() {
        val xml = foreground.readText()
        listOf(
            "#FACC15",
            "#34D399",
            "#F87171",
            "#FFFFFF",
            "#1D4ED8",
            // The sweep's two gradient stops, with the alpha the desktop SVG
            // carries as stop-opacity: 55% and 0%.
            "#8060A5FA",
            "#0038BDF8",
        ).forEach {
            assertTrue("the launcher foreground must carry $it", xml.contains(it))
        }
    }

    @Test
    fun `the launcher background carries the desktop gradient`() {
        assertTrue("the launcher background must exist", background.exists())
        val xml = background.readText()
        listOf(
            "#1E3A8A" to "0",
            "#1D4ED8" to "0.5",
            "#2563EB" to "1",
        ).forEach { (color, offset) ->
            assertTrue("the launcher background must carry $color", xml.contains(attr("android:color", color)))
            assertTrue("the launcher background must place $color at $offset", xml.contains(attr("android:offset", offset)))
        }
    }

    @Test
    fun `the adaptive icon points at the radar layers`() {
        assertTrue("the adaptive icon must exist", adaptive.exists())
        val xml = adaptive.readText()
        assertTrue("the adaptive icon must use the gradient background", xml.contains("""@drawable/ic_launcher_background"""))
        assertTrue("the adaptive icon must use the radar foreground", xml.contains("""@drawable/ic_launcher_foreground"""))
    }

    @Test
    fun `the in-app mark uses the desktop palette`() {
        assertRgb("1E3A8A", RadarMarkColors.BackgroundTop)
        assertRgb("1D4ED8", RadarMarkColors.BackgroundMiddle)
        assertRgb("2563EB", RadarMarkColors.BackgroundBottom)
        assertRgb("60A5FA", RadarMarkColors.SweepStart)
        assertRgb("38BDF8", RadarMarkColors.SweepEnd)
        assertRgb("FACC15", RadarMarkColors.Needle)
        assertRgb("FFFFFF", RadarMarkColors.Hub)
        assertRgb("1D4ED8", RadarMarkColors.HubCore)
        assertRgb("34D399", RadarMarkColors.BlipFound)
        assertRgb("F87171", RadarMarkColors.BlipUrgent)

        // The sweep fades out towards the rim, exactly like the SVG's
        // stop-opacity="0" on the last stop.
        assertEquals(0.55f, RadarMarkColors.SweepStart.alpha, 0.01f)
        assertEquals(0f, RadarMarkColors.SweepEnd.alpha, 0.001f)
    }

    /** A VectorDrawable circle: a move to the centre, then two half arcs. */
    private fun circle(
        centerX: String,
        centerY: String,
        radius: Float,
    ): String {
        val r = n(radius)
        val diameter = n(2 * radius)
        return "M$centerX,$centerY m-$r,0 a$r,$r 0 1,1 $diameter,0 a$r,$r 0 1,1 -$diameter,0"
    }

    private fun assertRgb(
        expected: String,
        color: Color,
    ) {
        val actual = String.format("%02X%02X%02X", channel(color.red), channel(color.green), channel(color.blue))
        assertEquals("the mark's palette drifted from the desktop SVG", expected, actual)
    }

    private fun channel(value: Float): Int = (value * 255f + 0.5f).toInt()

    /** A VectorDrawable attribute, as it appears in the XML. */
    private fun attr(
        name: String,
        value: String,
    ): String = "$name=\"$value\""

    /** A VectorDrawable capsule - how a binder tab is drawn. */
    private fun capsule(tabX: Float): String {
        val geo = RadarMarkGeometry
        val left = n(geo.launcher(tabX))
        val right = n(geo.launcher(tabX + geo.TAB_WIDTH))
        val radius = n(geo.launcherSize(geo.TAB_RADIUS))
        val shoulder = n(geo.launcher(geo.TAB_Y + geo.TAB_RADIUS))
        val hip = n(geo.launcher(geo.TAB_Y + geo.TAB_HEIGHT - geo.TAB_RADIUS))
        return "M$left,$shoulder A$radius,$radius 0 0 1 $right,$shoulder " +
            "L$right,$hip A$radius,$radius 0 0 1 $left,$hip Z"
    }

    /** The shortest exact decimal for a design-space coordinate. */
    private fun n(value: Float): String = BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
}
