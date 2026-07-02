# Blender 5.x headless scene for the houtei-kenshu portal hero loop.
# Builds the dayos-style object (stacked hex column + docking hex pegs),
# animates a seamless 24s formation cycle, and renders a transparent PNG
# sequence with Cycles (Metal GPU).
#
# Usage:
#   Blender -b -P assets/blender/tower_loop.py -- --out /path/to/frames [--still]
import math
import sys

import bpy
from mathutils import Quaternion, Vector

FPS = 24
SECONDS = 24
FRAMES = FPS * SECONDS
RES_X = 420
RES_Y = 460
SEG_H = 0.7
COLUMN_TOP = SEG_H * 5
PEG_R = 0.42
PEG_LEN = 0.85

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = args[args.index("--out") + 1] if "--out" in args else "/tmp/tower_frames"
STILL_ONLY = "--still" in args


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_material(name, setup):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        output = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    setup(nodes, links, bsdf)
    return mat


def plain_setup(color, roughness):
    def setup(nodes, links, bsdf):
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = roughness

    return setup


def foam_setup(color, roughness=0.55):
    def setup(nodes, links, bsdf):
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = roughness
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 160
        noise.inputs["Detail"].default_value = 6
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.06
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    return setup


def terrazzo_setup(nodes, links, bsdf):
    bsdf.inputs["Roughness"].default_value = 0.5
    voronoi = nodes.new("ShaderNodeTexVoronoi")
    voronoi.inputs["Scale"].default_value = 26
    ramp_mask = nodes.new("ShaderNodeValToRGB")
    ramp_mask.color_ramp.interpolation = "CONSTANT"
    ramp_mask.color_ramp.elements[1].position = 0.22
    links.new(voronoi.outputs["Distance"], ramp_mask.inputs["Fac"])

    cell_bw = nodes.new("ShaderNodeVectorMath")
    cell_bw.operation = "DOT_PRODUCT"
    cell_bw.inputs[1].default_value = (0.4, 0.4, 0.2)
    links.new(voronoi.outputs["Color"], cell_bw.inputs[0])
    palette = nodes.new("ShaderNodeValToRGB")
    palette.color_ramp.interpolation = "CONSTANT"
    palette.color_ramp.elements[0].color = (0.28, 0.26, 0.23, 1)
    palette.color_ramp.elements[1].position = 0.4
    palette.color_ramp.elements[1].color = (0.62, 0.58, 0.5, 1)
    extra = palette.color_ramp.elements.new(0.7)
    extra.color = (0.45, 0.42, 0.36, 1)
    links.new(cell_bw.outputs["Value"], palette.inputs["Fac"])

    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (0.9, 0.885, 0.85, 1)
    links.new(ramp_mask.outputs["Color"], mix.inputs["Factor"])
    links.new(palette.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 120
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.03
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def wood_setup(nodes, links, bsdf):
    bsdf.inputs["Roughness"].default_value = 0.55
    wave = nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 5.5
    wave.inputs["Distortion"].default_value = 3.5
    wave.inputs["Detail"].default_value = 2
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.78, 0.58, 0.33, 1)
    ramp.color_ramp.elements[1].color = (0.9, 0.76, 0.55, 1)
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    links.new(wave.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def add_bevel(obj, width=0.025):
    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = width
    bevel.segments = 2
    bevel.angle_limit = math.radians(40)


def make_hex(name, radius, depth, materials, parent):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    for mat in materials:
        obj.data.materials.append(mat)
    add_bevel(obj)
    obj.parent = parent
    return obj


def assign_top_face(obj, material_index):
    mesh = obj.data
    for poly in mesh.polygons:
        if poly.normal.z > 0.9:
            poly.material_index = material_index


# --- scene ---------------------------------------------------------------
reset_scene()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.cycles.samples = 128
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
scene.cycles.time_limit = 3.5
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.view_settings.exposure = 0.35

prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for device in prefs.devices:
    device.use = True
scene.cycles.device = "GPU"

root = bpy.data.objects.new("root", None)
scene.collection.objects.link(root)

# Materials
mat_terrazzo = new_material("terrazzo", terrazzo_setup)
mat_wood = new_material("wood", wood_setup)
mat_walnut = new_material("walnut", plain_setup((0.028, 0.02, 0.017), 0.4))
mat_yellow = new_material("yellow", foam_setup((1.0, 0.88, 0.0)))
mat_mint = new_material("mint", foam_setup((0.62, 1.0, 0.55)))
mat_magenta = new_material("magenta", foam_setup((1.0, 0.06, 0.35), 0.5))
mat_pink = new_material("pink", plain_setup((1.0, 0.05, 0.33), 0.45))
mat_white = new_material("white_top", plain_setup((0.9, 0.885, 0.85), 0.55))

# Column segments (bottom → top)
seg_mats = [mat_wood, mat_walnut, mat_terrazzo, mat_yellow, mat_terrazzo]
segments = []
for i, mat in enumerate(seg_mats):
    seg = make_hex(f"seg{i}", 1.0, SEG_H, [mat], root)
    seg.location = (0, 0, SEG_H * (i + 0.5))
    segments.append(seg)

# Pink cavity cap on the crown
segments[4].data.materials.append(mat_pink)
assign_top_face(segments[4], 1)
# Pale wood cap on the base segment (visible only if it ever moves)
segments[0].data.materials.append(mat_white)

# Pegs docked into the column faces
PEG_SPECS = [
    (mat_yellow, 0.2, 2.75),
    (mat_mint, 1.25, 1.85),
    (mat_magenta, 2.3, 2.4),
    (mat_yellow, 3.35, 1.2),
    (mat_terrazzo, 4.9, 2.05),
]
pegs = []
for i, (mat, theta, height) in enumerate(PEG_SPECS):
    peg = make_hex(f"peg{i}", PEG_R, PEG_LEN, [mat], root)
    peg.rotation_mode = "QUATERNION"
    direction = Vector((math.cos(theta), math.sin(theta), 0))
    crown_angle = (i / len(PEG_SPECS)) * math.tau
    pegs.append(
        {
            "obj": peg,
            "theta": theta,
            "height": height,
            "crown_angle": crown_angle,
            "q_dock": direction.to_track_quat("Z", "Y"),
            "q_crown": Quaternion((0, 0, 1), crown_angle),
        }
    )

# Floor slabs
for name, mat, loc, rot in [
    ("slab_mint", mat_mint, (1.45, -0.8, 0.08), 0.4),
    ("slab_yellow", mat_yellow, (-1.5, -0.95, 0.08), -0.55),
]:
    bpy.ops.mesh.primitive_cube_add(size=1)
    slab = bpy.context.object
    slab.name = name
    slab.scale = (0.48, 0.31, 0.08)
    slab.location = loc
    slab.rotation_euler = (0, 0, rot)
    slab.data.materials.append(mat)
    add_bevel(slab, 0.02)
    slab.parent = root

# Shadow catcher floor
bpy.ops.mesh.primitive_plane_add(size=24)
floor = bpy.context.object
floor.name = "floor"
floor.is_shadow_catcher = True

# Lights: soft studio boxes + gentle world
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
if bg is None:
    bg = world.node_tree.nodes.new("ShaderNodeBackground")
    out = next(n for n in world.node_tree.nodes if n.type == "OUTPUT_WORLD")
    world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
bg.inputs["Color"].default_value = (0.85, 0.86, 0.88, 1)
bg.inputs["Strength"].default_value = 0.4

key = bpy.data.lights.new("key", "AREA")
key.energy = 900
key.size = 6
key_obj = bpy.data.objects.new("key", key)
key_obj.location = (-4.5, -3.5, 8)
key_obj.rotation_euler = (math.radians(35), math.radians(-28), math.radians(-15))
scene.collection.objects.link(key_obj)

fill = bpy.data.lights.new("fill", "AREA")
fill.energy = 260
fill.size = 5
fill.color = (1.0, 0.96, 0.86)
fill_obj = bpy.data.objects.new("fill", fill)
fill_obj.location = (5.5, -2.5, 4.5)
fill_obj.rotation_euler = (math.radians(60), math.radians(35), math.radians(20))
scene.collection.objects.link(fill_obj)

rim = bpy.data.lights.new("rim", "AREA")
rim.energy = 200
rim.size = 4
rim_obj = bpy.data.objects.new("rim", rim)
rim_obj.location = (0, 5, 6)
rim_obj.rotation_euler = (math.radians(-40), 0, 0)
scene.collection.objects.link(rim_obj)

# Camera (Z up: in front of the object along -Y)
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle_y = math.radians(32)
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0, -9.4, 4.4)
scene.collection.objects.link(cam)
scene.camera = cam
look = Vector((0, 0, 2.25)) - cam.location
cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()


# --- animation -----------------------------------------------------------
def frame_at(fraction):
    return 1 + fraction * (FRAMES - 1)


def key_loc(obj, fraction, location):
    obj.location = location
    obj.keyframe_insert("location", frame=frame_at(fraction))


def key_quat(obj, fraction, quat):
    obj.rotation_quaternion = quat
    obj.keyframe_insert("rotation_quaternion", frame=frame_at(fraction))


# Root sway (seamless: sin over the full loop)
root.rotation_mode = "XYZ"
for fraction, angle in [(0, 0), (0.25, 0.3), (0.5, 0), (0.75, -0.3), (1.0, 0)]:
    root.rotation_euler = (0, 0, angle)
    root.keyframe_insert("rotation_euler", frame=frame_at(fraction))

# Column beats
crown = segments[4]
for fraction, dz in [(0.14, 0), (0.2, 0.42), (0.24, 0.42), (0.3, 0)]:
    key_loc(crown, fraction, (0, 0, SEG_H * 4.5 + dz))
terr = segments[2]
for fraction, dx in [(0.44, 0), (0.5, -0.3), (0.56, 0)]:
    key_loc(terr, fraction, (dx, 0, SEG_H * 2.5))
band = segments[3]
for fraction, dx in [(0.8, 0), (0.85, 0.32), (0.9, 0)]:
    key_loc(band, fraction, (dx, 0, SEG_H * 3.5))

# Peg formation cycle
for i, peg in enumerate(pegs):
    obj = peg["obj"]
    theta = peg["theta"]
    docked = Vector((math.cos(theta) * 1.14, math.sin(theta) * 1.14, peg["height"]))
    exploded = Vector(
        (
            math.cos(theta + 0.35) * 1.95,
            math.sin(theta + 0.35) * 1.95,
            peg["height"] + 0.55,
        )
    )
    crown_pos = Vector(
        (
            math.cos(peg["crown_angle"]) * 0.58,
            math.sin(peg["crown_angle"]) * 0.58,
            COLUMN_TOP + PEG_LEN / 2 + 0.03,
        )
    )
    q_dock = peg["q_dock"]
    q_crown = peg["q_crown"]
    q_flight = q_dock.slerp(q_crown, 0.5) @ Quaternion(Vector((0.4, 0.8, 0.45)).normalized(), math.pi * 0.9)
    cascade_start = 0.62 + i * 0.028
    cascade_end = cascade_start + 0.06

    key_loc(obj, 0, docked)
    key_quat(obj, 0, q_dock)
    key_loc(obj, 0.08, docked)
    key_quat(obj, 0.08, q_dock)
    key_loc(obj, 0.13, exploded)
    # Wobble while exploded (sin-sampled so the segment stays smooth)
    for step in range(5):
        fraction = 0.13 + (step / 4) * 0.17
        wobble = Vector(
            (
                math.cos(step * 1.7 + i) * 0.07,
                math.sin(step * 2.1 + i) * 0.07,
                math.sin(step * 1.3 + i * 1.9) * 0.1,
            )
        )
        key_loc(obj, fraction, exploded + (wobble if 0 < step < 4 else Vector()))
        tilt = (
            Quaternion(Vector((1, 0.6, 0.2)).normalized(), 0.1 * math.sin(step + i))
            if 0 < step < 4
            else Quaternion()
        )
        key_quat(obj, fraction, tilt @ q_dock)
    # Flight to the crown with a raised arc and a tumble
    mid = (exploded + crown_pos) / 2 + Vector((0, 0, 1.05))
    key_loc(obj, 0.35, mid)
    key_quat(obj, 0.35, q_flight)
    key_loc(obj, 0.4, crown_pos)
    key_quat(obj, 0.4, q_crown)
    key_loc(obj, cascade_start, crown_pos)
    key_quat(obj, cascade_start, q_crown)
    # Cascade home
    mid_home = (crown_pos + docked) / 2 + Vector((0, 0, 0.85))
    key_loc(obj, cascade_start + 0.03, mid_home)
    key_quat(
        obj,
        cascade_start + 0.03,
        q_crown.slerp(q_dock, 0.5) @ Quaternion(Vector((0.3, 0.7, 0.5)).normalized(), math.pi * 0.7),
    )
    key_loc(obj, cascade_end, docked)
    key_quat(obj, cascade_end, q_dock)
    key_loc(obj, 1.0, docked)
    key_quat(obj, 1.0, q_dock)

# --- render --------------------------------------------------------------
scene.render.filepath = f"{OUT_DIR}/f"
# Resume-friendly: skip frames that already exist so a crashed run can be
# relaunched until the sequence completes.
scene.render.use_overwrite = False
scene.render.use_placeholder = False
if STILL_ONLY:
    scene.frame_set(int(frame_at(0.05)))
    scene.render.filepath = f"{OUT_DIR}/still_docked"
    bpy.ops.render.render(write_still=True)
    scene.frame_set(int(frame_at(0.22)))
    scene.render.filepath = f"{OUT_DIR}/still_exploded"
    bpy.ops.render.render(write_still=True)
    scene.frame_set(int(frame_at(0.5)))
    scene.render.filepath = f"{OUT_DIR}/still_crown"
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
