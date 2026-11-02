package com.quizradar.app.ui.icons

import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.VectorPath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.security.MessageDigest

/**
 * Guards the local icon set against accidental edits.
 *
 * The fingerprints were captured from the Material icons of
 * `androidx.compose.material:material-icons-core:1.7.6` and
 * `androidx.compose.material:material-icons-extended:1.7.6` before those
 * artifacts were dropped from the build, so a mismatch means the glyph no
 * longer draws the same shape, paint or viewport.
 */
class LocalIconsGoldenTest {
    @Test
    fun `every local icon still draws the captured Material glyph`() {
        val icons = localIcons()
        assertEquals("the local icon set changed size", golden.size, icons.size)
        icons.forEach { icon ->
            val expected = golden[icon.name]
            assertNotNull("no fingerprint was captured for ${icon.name}", expected)
            val actual = fingerprint(icon)
            assertEquals(
                "the glyph of ${icon.name} changed; the fingerprint input was:\n$actual",
                expected,
                sha256(actual),
            )
        }
    }

    @Test
    fun `the default variant is an alias of the filled variant`() {
        assertEquals(Icons.Filled.Close, Icons.Default.Close)
    }

    @Test
    fun `every icon is a 24 dp square on a 24 unit viewport`() {
        localIcons().forEach { icon ->
            assertEquals("${icon.name} width", 24f, icon.defaultWidth.value, 0f)
            assertEquals("${icon.name} height", 24f, icon.defaultHeight.value, 0f)
            assertEquals("${icon.name} viewport width", 24f, icon.viewportWidth, 0f)
            assertEquals("${icon.name} viewport height", 24f, icon.viewportHeight, 0f)
        }
    }
}

private val golden: Map<String, String> =
    mapOf(
        "Filled.CalendarMonth" to "f0cf04af3bf3fcb7631c091628a17dcc3069679a0b8835d05fb56ffeb7e3cd86",
        "Filled.Close" to "404a7f006743cc2d9f9b65c75880d45d39d3e8f8f24ad7ae808ae378dd6a747e",
        "Filled.Place" to "c6838a0ad49be495f37d02e9c73c56e9b6f01a625d6bc8c10067f0ee071382af",
        "Filled.SquareFoot" to "3777d964697b46341bbb0a159826f5013b9406b273c1f421541f602ee94fda79",
        "Filled.Visibility" to "595e90679d4801f2b1ccd18fd8314f60bdd639afa427f205406cf390b9b96246",
        "Filled.VisibilityOff" to "c5c572e484f3db5b0ed18a100c2fdd94a313a206aa35b8f2393931d09dbf0efb",
        "Outlined.AccountCircle" to "24ed4edc527e33bb2bfa88ac47d8957aeb4b726cba911c6d8860c8e97e34dd5c",
        "Outlined.Add" to "7abcfe244475a57f3d30e1d7eed8dccb56140d1f6f7fd0c1372fe3ba540181fe",
        "Outlined.AutoAwesome" to "d085936182c4d052e762e2c1b4ba65940bb5e87f5366181731da3bf8f599ef9a",
        "Outlined.CalendarMonth" to "9f11ae5ca5f3710c2b201facda65161afbbb0bdd68abdfaf25a8425b50db438a",
        "Outlined.CalendarToday" to "98486f9d91a9f758e73ace051790246a2769d878889408ba643161c57fbbfcd7",
        "Outlined.Check" to "539cbb125903051057a3defea28d91f403ef37b7ad7915f4641b3cf446077461",
        "Outlined.CheckCircle" to "a52abe5e783e676af5c4ca1c2a57c585ac5609eae61deddbe0d5713986eb8beb",
        "Outlined.Checklist" to "27fb605ed670137cc14a95d98c8fffe4ad4d9b8c12e4c7384a070b7f19e96ea3",
        "Outlined.Close" to "a3717f181203ca64b53b82a48f3137d064f37d15c4f26216691d82eaa1ff512e",
        "Outlined.Dashboard" to "46823ba157f1396eecb0884c3a5c6f652e78059102d4d1640e23d49828f50e47",
        "Outlined.Delete" to "f3435ef1df9a2b2c9bdcd32e4c79fb2bddb9045ced3712dc2309501adb7ce634",
        "Outlined.Download" to "7fe8c5662d26ed7cd5fb38b69d7818e6369e7be7e6c38a45f296daf15a639a59",
        "Outlined.Email" to "e35879c7b4db9fdc6d824e9574649658e5f9e55d38777d819809df2155cf4cb3",
        "Outlined.Event" to "9d595af2719c3cbf753d57a6e47248c7713abf1c27865de11a8c35cfffe06bc8",
        "Outlined.Groups" to "8f3a13ed10bb65e917f287a15a788adf95521d610f141da58e4f9bf064b45efc",
        "Outlined.Info" to "0926ea1d7532d32ba6b4a076bc9de224f8b29838ad22e148661d8d0f7bdaec3c",
        "Outlined.Notifications" to "2b09a0889426e08c013a2980d61827c1befda0f873424d19f21613039758570b",
        "Outlined.Palette" to "b718c72c5dcdb532593e9051abf4b221a9dd2255f9991c380486e25fa1ac6fb9",
        "Outlined.Pause" to "04ab7762a06a4af24705ce6f7e86d59579ce6038669c04d74412070c00396fd9",
        "Outlined.Person" to "7ceebb039ad9769c77f2b0d3c67198403235c1dc2adf849aaca5eadc51beb357",
        "Outlined.PlayArrow" to "4098731c4f873bf7932460fe4f3dcb1d395e17b0ceede107da179cafe05c5b17",
        "Outlined.Quiz" to "75c098d2dec17ca9f79e6fb928276742dd32c043b8a61247698aed96fce82823",
        "Outlined.RadioButtonUnchecked" to "16ae8ce40165ee00bf35f30839344d770fa2669a20aff58cdf5b92cef93d78c4",
        "Outlined.Refresh" to "6dc30e7d4222138696d34a1be9c9cad2ae32b96d30dc53dbe3108992b44cd521",
        "Outlined.RssFeed" to "0a5d71cf1ed6d534b70744ce7e0c8e81f1a100f9d0af658cf36d0d18d5ec6bb8",
        "Outlined.Save" to "74f30b267117aaebabfdb0ea10dea52f09c3fa09dd3806dd530d67484bd0a433",
        "Outlined.School" to "7f2d693ef1fa3a38bc16adfac708dd442d7f325a3dd090902a8eecfbc9aae42c",
        "Outlined.Search" to "d2e73853ee4992ea0abaaa81be0ab1988d92c6c09bac4b9d1b597349cc85c70e",
        "Outlined.Settings" to "4e61db0e5978fa633a36b069abf928b3cf2507b85195ad0a4d79bae3a781cb31",
        "Outlined.Share" to "1ac1a313698073a29e4cd4c103cc9b0bfd2a9f6951a99667f591cfe87a54175f",
        "Outlined.Shield" to "53c26ebac3f70a6707449828e5aeb3ef36fce443be7d0ee982ce2f0283d8d9e9",
        "Outlined.SpaceDashboard" to "3de85fd3d2dff33d1c5ea62db68a7ff1faca296b500e286f50ec92d651118f25",
        "Outlined.Storage" to "95739735e68768d13cb196bf1cf78d9415d4281467f3f0f5a96d0b41f3bd3369",
        "Outlined.Sync" to "b6fc9b9bb8269e00b05b7aa1be1ec23e334c9cd46b34e0dce2d99a01131f62e1",
        "Outlined.Timer" to "5de06a79d0c1cad72255424633af683b5c5307a83a9310edf84c40ffb0da72a2",
        "Outlined.UploadFile" to "a5b61803fed0401817a66507b5dc37312cfcd5d8c7b5aeefb62525198e638ba6",
        "Outlined.Warning" to "204afb8b0ce02ce52b43ed112388b26b30004f97a0eedb40dce08d972bd0066f",
        "Outlined.Widgets" to "cf43317322b13684610fc0cfb8b1e290312632d65895298ba356bbfa4beea01a",
        "AutoMirrored.Filled.ArrowBack" to "d8e381311e807ed9a76ab5d807ce3b6dbad3d46acf74af3a9bb0a097e3693fb0",
        "AutoMirrored.Filled.ArrowForward" to "249114d570f8d2c1de1decaf14454754b34dcbbbb6ecc2dd3712f9d5e19dbdbd",
    )

private fun localIcons(): List<ImageVector> =
    listOf(
        Icons.Filled.CalendarMonth,
        Icons.Filled.Close,
        Icons.Filled.Place,
        Icons.Filled.SquareFoot,
        Icons.Filled.Visibility,
        Icons.Filled.VisibilityOff,
        Icons.Outlined.AccountCircle,
        Icons.Outlined.Add,
        Icons.Outlined.AutoAwesome,
        Icons.Outlined.CalendarMonth,
        Icons.Outlined.CalendarToday,
        Icons.Outlined.Check,
        Icons.Outlined.CheckCircle,
        Icons.Outlined.Checklist,
        Icons.Outlined.Close,
        Icons.Outlined.Dashboard,
        Icons.Outlined.Delete,
        Icons.Outlined.Download,
        Icons.Outlined.Email,
        Icons.Outlined.Event,
        Icons.Outlined.Groups,
        Icons.Outlined.Info,
        Icons.Outlined.Notifications,
        Icons.Outlined.Palette,
        Icons.Outlined.Pause,
        Icons.Outlined.Person,
        Icons.Outlined.PlayArrow,
        Icons.Outlined.Quiz,
        Icons.Outlined.RadioButtonUnchecked,
        Icons.Outlined.Refresh,
        Icons.Outlined.RssFeed,
        Icons.Outlined.Save,
        Icons.Outlined.School,
        Icons.Outlined.Search,
        Icons.Outlined.Settings,
        Icons.Outlined.Share,
        Icons.Outlined.Shield,
        Icons.Outlined.SpaceDashboard,
        Icons.Outlined.Storage,
        Icons.Outlined.Sync,
        Icons.Outlined.Timer,
        Icons.Outlined.UploadFile,
        Icons.Outlined.Warning,
        Icons.Outlined.Widgets,
        Icons.AutoMirrored.Filled.ArrowBack,
        Icons.AutoMirrored.Filled.ArrowForward,
    )

private fun PathNode.token(): String =
    if (this is PathNode.Close) {
        "Close"
    } else {
        toString()
    }

private fun VectorPath.paint(): String =
    buildString {
        append(name ?: "-")
        append('/')
        append(if (fill is SolidColor) "solid:${(fill as SolidColor).value}" else "fill:${fill?.javaClass?.simpleName}")
        append('/')
        append(fillAlpha)
        append('/')
        append(if (stroke == null) "nostroke" else "stroke")
        append('/')
        append(strokeAlpha)
        append('/')
        append(strokeLineWidth)
        append('/')
        append(strokeLineCap)
        append('/')
        append(strokeLineJoin)
        append('/')
        append(strokeLineMiter)
        append('/')
        append(if (pathFillType == PathFillType.NonZero) "nonzero" else "evenodd")
        append('/')
        append(trimPathStart)
        append('/')
        append(trimPathEnd)
        append('/')
        append(trimPathOffset)
    }

private fun fingerprint(vector: ImageVector): String =
    buildString {
        append(vector.name)
        append('|')
        append(vector.viewportWidth)
        append('x')
        append(vector.viewportHeight)
        append('|')
        if (vector.autoMirror) append("mirror|")
        vector.root.forEach { node ->
            if (node is VectorPath) {
                append(node.paint())
                append('[')
                append(node.pathData.joinToString(" ") { it.token() })
                append(']')
                append(';')
            }
        }
    }

private fun sha256(text: String): String =
    MessageDigest
        .getInstance("SHA-256")
        .digest(text.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
